//! Ejecución de un trabajo con reintentos: cortes del canal, caídas de la sesión y borrado
//! de lo parcial al cancelar.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::super::copy::{CopyError, CopyResult, Ctrl};
use super::super::policy::Conflict;
use super::attempt::try_once;
use super::state::{Kind, Outcome};
use super::{Engine, CLOSED_MSG, MAX_RETRIES};
use crate::types::{TransferDirection, TransferJob};

impl Engine {
    /// La conexión de `session_id` desapareció. Si se espera reconexión, la sesión queda
    /// "caída" (su cola se congela) y el trabajo vuelve a la cola sin gastar reintentos.
    /// Si en realidad ya volvió, devuelve `Transient` para reintentar enseguida.
    async fn lost(&self, session_id: &str) -> CopyError {
        if !self.env.auto_reconnect() || self.lock().closed.contains(session_id) {
            return CopyError::Fatal(CLOSED_MSG.into());
        }
        self.lock().down.entry(session_id.to_string()).or_insert_with(Instant::now);
        // La reconexión pudo terminar justo antes de marcarla caída.
        if self.env.session(session_id).await.is_ok_and(|s| !s.is_closed()) {
            self.lock().down.remove(session_id);
            return CopyError::Transient("Se perdió la conexión".into());
        }
        CopyError::Disconnected
    }

    /// Copia con reintentos automáticos ante cortes del canal.
    pub(super) async fn execute(
        &self,
        job: &mut TransferJob,
        kind: &Kind,
        policy: Conflict,
        check: bool,
        ctrl: &Ctrl,
    ) -> CopyResult<Outcome> {
        let mut attempt = 0u32;
        let mut recovered = 0u32;
        let mut check = check;
        let mut verify = ctrl.progress.load(Ordering::Relaxed) > 0;
        loop {
            if ctrl.token.is_cancelled() {
                return Err(CopyError::Stopped);
            }
            let leased = tokio::select! {
                biased;
                _ = ctrl.token.cancelled() => return Err(CopyError::Stopped),
                r = self.session_lease(&job.session_id) => r,
            };
            let (closed, mut lease, result) = match leased {
                Err(msg) if msg == CLOSED_MSG => (true, None, Err(CopyError::Transient(msg))),
                Err(msg) => (false, None, Err(CopyError::Transient(msg))),
                Ok((session, lease)) => {
                    let r = try_once(job, kind, policy, &mut check, verify, lease.chan(), ctrl).await;
                    (session.is_closed(), Some(lease), r)
                }
            };
            match result {
                Err(CopyError::Transient(msg)) => {
                    if let Some(l) = lease.as_mut() {
                        l.mark_broken();
                    }
                    drop(lease);
                    let wait = if closed {
                        match self.lost(&job.session_id).await {
                            CopyError::Transient(_) if recovered < 5 => recovered += 1,
                            CopyError::Transient(m) => return Err(CopyError::Fatal(m)),
                            other => return Err(other),
                        }
                        Duration::from_millis(300)
                    } else {
                        attempt += 1;
                        if attempt > MAX_RETRIES {
                            return Err(CopyError::Fatal(format!("{msg} (tras {MAX_RETRIES} reintentos)")));
                        }
                        Duration::from_millis(500 * (1 << (attempt - 1)))
                    };
                    log::warn!("transferencia {}: {msg}; reintento {attempt}", job.name);
                    tokio::select! {
                        biased;
                        _ = ctrl.token.cancelled() => return Err(CopyError::Stopped),
                        _ = self.resumed.notified() => {}
                        _ = tokio::time::sleep(wait) => {}
                    }
                    verify = true;
                }
                other => return other,
            }
        }
    }

    pub(super) async fn delete_partial(&self, job: &TransferJob) {
        match job.direction {
            TransferDirection::Download => {
                let _ = tokio::fs::remove_file(&job.local_path).await;
            }
            TransferDirection::Upload => {
                if let Ok((_s, lease)) = self.session_lease(&job.session_id).await {
                    let _ = lease.chan().raw.remove(job.remote_path.clone()).await;
                }
            }
        }
    }
}
