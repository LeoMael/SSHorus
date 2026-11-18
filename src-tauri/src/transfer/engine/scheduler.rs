//! Planificador: reparte turnos por sesión y aplica el resultado de cada trabajo.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::super::copy::{CopyError, Ctrl, STOP_CANCEL, STOP_PAUSE};
use super::super::policy::{Conflict, ConflictQuestion, ASK_MSG};
use super::state::{Kind, Outcome};
use super::{now_ms, Engine, WAITING_MSG};
use crate::types::TransferStatus;

impl Engine {
    pub(super) fn schedule(self: &Arc<Self>) {
        let limit = self.env.concurrency().clamp(1, 8);
        let mut start = Vec::new();
        {
            let mut guard = self.lock();
            let st = &mut *guard;
            // Trabajos en marcha por sesión: el límite es POR SESIÓN.
            let mut per: HashMap<String, usize> = HashMap::new();
            for id in &st.running {
                if let Some(e) = st.jobs.get(id) {
                    *per.entry(e.job.session_id.clone()).or_default() += 1;
                }
            }
            let sids: Vec<String> = st.queues.keys().cloned().collect();
            for sid in sids {
                // Sesión caída: su cola espera a la reconexión.
                if st.down.contains_key(&sid) {
                    continue;
                }
                let mut n = per.get(&sid).copied().unwrap_or(0);
                while n < limit {
                    let Some(id) = st.queues.get_mut(&sid).and_then(|q| q.pop_front()) else { break };
                    let Some(e) = st.jobs.get_mut(&id) else { continue };
                    if e.job.status != TransferStatus::Queued || e.ctrl.is_some() {
                        continue;
                    }
                    let ctrl = Arc::new(Ctrl::new(e.job.transferred));
                    ctrl.touched.store(e.touched, Ordering::Relaxed);
                    e.ctrl = Some(ctrl.clone());
                    e.job.status = TransferStatus::Running;
                    e.job.error = None;
                    e.job.speed = 0.0;
                    e.last_bytes = e.job.transferred;
                    st.running.push(id.clone());
                    st.mark(&id);
                    start.push((id, ctrl));
                    n += 1;
                }
                if st.queues.get(&sid).is_some_and(|q| q.is_empty()) {
                    st.queues.remove(&sid);
                }
            }
        }
        for (id, ctrl) in start {
            let me = self.clone();
            tokio::spawn(async move { me.run_job(id, ctrl).await });
        }
        self.kick();
    }

    async fn run_job(self: Arc<Self>, id: String, ctrl: Arc<Ctrl>) {
        let Some((mut job, kind, policy, check)) = ({
            let st = self.lock();
            st.jobs.get(&id).map(|e| {
                let batch = st.batches.get(&e.job.batch_id).map(|b| b.policy).unwrap_or_default();
                // La respuesta del usuario a este archivo manda sobre la del lote.
                let policy = e.decision.unwrap_or(batch);
                // La política solo se aplica antes de tocar el destino (no al reanudar).
                let check = !e.touched && e.job.transferred == 0;
                (e.job.clone(), e.kind.clone(), policy, check)
            })
        }) else {
            return;
        };
        let res = match kind {
            Kind::File { .. } | Kind::Link { .. } => self.execute(&mut job, &kind, policy, check, &ctrl).await,
            _ => Err(CopyError::Fatal("No reintentable".into())),
        };
        let stop = ctrl.stop.load(Ordering::SeqCst);
        let touched = ctrl.touched.load(Ordering::Relaxed);
        let canceled = matches!(res, Err(CopyError::Stopped)) && stop == STOP_CANCEL;
        if canceled && touched {
            self.delete_partial(&job).await;
        }
        let mut ask: Option<ConflictQuestion> = None;
        {
            let mut st = self.lock();
            st.running.retain(|x| x != &id);
            let mut requeue = false;
            let (batch_policy, batch_paused, batch_canceled) = st
                .batches
                .get(&job.batch_id)
                .map(|b| (b.policy, b.paused, b.canceled))
                .unwrap_or((Conflict::Overwrite, false, true));
            if let Some(e) = st.jobs.get_mut(&id) {
                // "Mantener ambos" pudo cambiar el destino.
                e.job.local_path.clone_from(&job.local_path);
                e.job.remote_path.clone_from(&job.remote_path);
                e.job.name.clone_from(&job.name);
                e.ctrl = None;
                e.touched = touched && !canceled;
                e.job.speed = 0.0;
                let progress = ctrl.progress.load(Ordering::Relaxed);
                match res {
                    Ok(Outcome::Copied(n)) => {
                        e.job.status = TransferStatus::Done;
                        e.job.size = n;
                        e.job.transferred = n;
                        e.job.error = None;
                        e.job.finished_at = Some(now_ms());
                    }
                    Ok(Outcome::Skipped(why)) => {
                        e.job.status = TransferStatus::Skipped;
                        e.job.transferred = 0;
                        e.job.error = Some(why);
                        e.job.finished_at = Some(now_ms());
                    }
                    Ok(Outcome::Ask(q)) => {
                        // `stop` se relee con el candado tomado: cancelar/pausar lo cambian
                        // también con el candado, así no se cuela una pregunta huérfana.
                        let stop = ctrl.stop.load(Ordering::SeqCst);
                        if stop == STOP_CANCEL || batch_canceled {
                            e.job.status = TransferStatus::Canceled;
                            e.job.finished_at = Some(now_ms());
                        } else if (stop == STOP_PAUSE || batch_paused) && !e.resume_after_stop {
                            e.job.status = TransferStatus::Paused;
                        } else if batch_policy != Conflict::Ask {
                            // Mientras tanto se respondió "aplicar a todos": sin preguntar.
                            e.job.status = TransferStatus::Queued;
                            requeue = true;
                        } else {
                            e.job.status = TransferStatus::Queued;
                            e.job.error = Some(ASK_MSG.into());
                            ask = Some(*q);
                        }
                    }
                    Err(CopyError::Stopped) if canceled => {
                        e.job.status = TransferStatus::Canceled;
                        e.job.transferred = progress;
                        e.job.finished_at = Some(now_ms());
                    }
                    Err(CopyError::Stopped) => {
                        e.job.transferred = progress;
                        if e.resume_after_stop {
                            e.job.status = TransferStatus::Queued;
                            requeue = true;
                        } else {
                            e.job.status = TransferStatus::Paused;
                        }
                    }
                    Err(CopyError::Disconnected) => {
                        // Vuelve a la cola de su sesión; sigue al reconectar.
                        e.job.transferred = progress;
                        e.job.status = TransferStatus::Queued;
                        e.job.error = Some(WAITING_MSG.into());
                        requeue = true;
                    }
                    Err(CopyError::Transient(m)) | Err(CopyError::Fatal(m)) => {
                        e.job.status = TransferStatus::Error;
                        e.job.error = Some(m);
                        e.job.transferred = progress;
                        e.job.finished_at = Some(now_ms());
                    }
                }
                e.resume_after_stop = false;
            }
            if requeue {
                st.enqueue(&id, true);
            }
            if let Some(q) = &ask {
                st.questions.insert(id.clone(), q.clone());
            }
            st.mark(&id);
        }
        if let Some(q) = ask {
            self.env.emit_conflict(q);
        }
        self.schedule();
    }
}
