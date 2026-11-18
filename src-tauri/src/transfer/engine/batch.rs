//! Lotes: alta de lotes y trabajos, fin del recorrido y limpieza de los terminados.

use std::path::Path;
use std::sync::Arc;

use super::super::policy::Conflict;
use super::state::{Batch, Entry, Kind, NewJob};
use super::{now_ms, Engine};
use crate::types::{TransferDirection, TransferJob, TransferStatus};

impl Engine {
    /// Quita terminados (done / skipped / canceled / error). Devuelve los ids quitados (ya emitidos).
    pub fn clear_finished(&self) -> Vec<String> {
        let removed: Vec<String> = {
            let mut st = self.lock();
            let removed: Vec<String> = st
                .order
                .iter()
                .filter(|id| {
                    st.jobs.get(*id).is_some_and(|e| {
                        e.ctrl.is_none()
                            && matches!(
                                e.job.status,
                                TransferStatus::Done
                                    | TransferStatus::Skipped
                                    | TransferStatus::Canceled
                                    | TransferStatus::Error
                            )
                    })
                })
                .cloned()
                .collect();
            if removed.is_empty() {
                return removed;
            }
            let set: std::collections::HashSet<&String> = removed.iter().collect();
            st.order.retain(|id| !set.contains(id));
            st.dirty.retain(|id| !set.contains(id));
            for b in st.batches.values_mut() {
                b.jobs.retain(|id| !set.contains(id));
            }
            st.batches.retain(|_, b| !b.jobs.is_empty() || b.walkers > 0);
            for id in &removed {
                st.jobs.remove(id);
            }
            removed
        };
        if !removed.is_empty() {
            self.env.emit_removed(removed.clone());
        }
        removed
    }

    /// ¿El lote terminó del todo (recorrido acabado y ningún trabajo pendiente)? Un lote que no
    /// existe cuenta como terminado. Lo usa "arrastrar al sistema" para no ofrecer una carpeta
    /// a medio descargar (el recorrido puede seguir añadiendo trabajos tras acabar los primeros).
    pub fn batch_finished(&self, batch_id: &str) -> bool {
        let st = self.lock();
        let Some(b) = st.batches.get(batch_id) else { return true };
        b.walkers == 0
            && b.jobs.iter().all(|id| {
                st.jobs.get(id).is_none_or(|e| {
                    e.ctrl.is_none()
                        && matches!(
                            e.job.status,
                            TransferStatus::Done
                                | TransferStatus::Skipped
                                | TransferStatus::Error
                                | TransferStatus::Canceled
                                | TransferStatus::Paused
                        )
                })
            })
    }

    pub(super) fn open_batch(&self, batch_id: &str, policy: Conflict) {
        let mut st = self.lock();
        st.batches.insert(
            batch_id.to_string(),
            Batch {
                jobs: Vec::new(),
                policy,
                paused: false,
                canceled: false,
                walkers: 1,
            },
        );
    }

    pub(super) fn walker_done(&self, batch_id: &str) {
        let mut st = self.lock();
        if let Some(b) = st.batches.get_mut(batch_id) {
            b.walkers = b.walkers.saturating_sub(1);
        }
    }

    pub(super) fn batch_canceled(&self, batch_id: &str) -> bool {
        self.lock().batches.get(batch_id).is_none_or(|b| b.canceled)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn make_job(
        batch_id: &str,
        session_id: &str,
        direction: TransferDirection,
        local: &Path,
        remote: &str,
        name: String,
        size: u64,
    ) -> TransferJob {
        TransferJob {
            id: uuid::Uuid::new_v4().to_string(),
            batch_id: batch_id.to_string(),
            session_id: session_id.to_string(),
            direction,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.to_string(),
            name,
            size,
            transferred: 0,
            status: TransferStatus::Queued,
            error: None,
            speed: 0.0,
            created_at: now_ms(),
            finished_at: None,
        }
    }

    pub(super) fn error_job(mut job: TransferJob, msg: String, kind: Kind) -> NewJob {
        job.status = TransferStatus::Error;
        job.error = Some(msg);
        job.finished_at = Some(now_ms());
        NewJob { job, kind }
    }

    pub(super) fn add_jobs(self: &Arc<Self>, batch_id: &str, new: Vec<NewJob>) {
        if new.is_empty() {
            return;
        }
        {
            let mut st = self.lock();
            let (paused, canceled) = match st.batches.get(batch_id) {
                Some(b) => (b.paused, b.canceled),
                None => return,
            };
            if canceled {
                return;
            }
            for NewJob { mut job, kind } in new {
                let id = job.id.clone();
                let enqueue = job.status == TransferStatus::Queued && !paused;
                if job.status == TransferStatus::Queued && paused {
                    job.status = TransferStatus::Paused;
                }
                st.order.push(id.clone());
                if let Some(b) = st.batches.get_mut(batch_id) {
                    b.jobs.push(id.clone());
                }
                st.jobs.insert(
                    id.clone(),
                    Entry {
                        job,
                        kind,
                        ctrl: None,
                        touched: false,
                        resume_after_stop: false,
                        decision: None,
                        dirty: false,
                        last_bytes: 0,
                    },
                );
                if enqueue {
                    st.enqueue(&id, false);
                }
                st.mark(&id);
            }
        }
        self.schedule();
    }
}
