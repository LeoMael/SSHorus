//! Emisor de progreso: cada ~200 ms calcula velocidades y envía solo los trabajos que
//! cambiaron; en reposo cierra canales ociosos y da por perdidas las sesiones caídas.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use super::{Engine, IDLE_CHECK, MAX_DOWN, TICK};
use crate::types::TransferJob;

impl Engine {
    pub(super) fn kick(self: &Arc<Self>) {
        self.notify.notify_one();
        if !self.emitter_started.swap(true, Ordering::SeqCst) {
            let me = self.clone();
            tokio::spawn(async move { me.emitter().await });
        }
    }

    async fn emitter(self: Arc<Self>) {
        loop {
            // En reposo: espera cambios; de paso cierra canales ociosos viejos y da por
            // perdidas las sesiones caídas que no volvieron.
            if tokio::time::timeout(IDLE_CHECK, self.notify.notified()).await.is_err() {
                self.pools.sweep();
                self.expire_down();
                continue;
            }
            self.lock().last_tick = Instant::now();
            loop {
                tokio::time::sleep(TICK).await;
                self.expire_down();
                let (jobs, active) = self.collect_changes();
                if !jobs.is_empty() {
                    self.env.emit_update(jobs);
                }
                if !active {
                    break;
                }
            }
        }
    }

    /// Actualiza progreso/velocidad de los activos y devuelve los trabajos cambiados.
    fn collect_changes(&self) -> (Vec<TransferJob>, bool) {
        let mut st = self.lock();
        let now = Instant::now();
        let dt = now.duration_since(st.last_tick).as_secs_f64().max(0.001);
        st.last_tick = now;
        let running = st.running.clone();
        for id in &running {
            let Some(e) = st.jobs.get_mut(id) else { continue };
            let Some(c) = &e.ctrl else { continue };
            let p = c.progress.load(Ordering::Relaxed);
            let inst = if p >= e.last_bytes { (p - e.last_bytes) as f64 / dt } else { 0.0 };
            e.last_bytes = p;
            let old = e.job.speed;
            let speed = if old <= 0.0 { inst } else { 0.35 * inst + 0.65 * old };
            let changed = p != e.job.transferred || (speed - old).abs() > 1.0;
            e.job.transferred = p;
            e.job.speed = if speed < 1.0 { 0.0 } else { speed };
            if changed {
                st.mark(id);
            }
        }
        let dirty = std::mem::take(&mut st.dirty);
        let mut out = Vec::with_capacity(dirty.len());
        for id in dirty {
            if let Some(e) = st.jobs.get_mut(&id) {
                e.dirty = false;
                out.push(e.job.clone());
            }
        }
        let active = !st.running.is_empty() || !st.dirty.is_empty();
        (out, active)
    }

    /// Sesiones caídas demasiado tiempo sin reconectar → se dan por cerradas.
    fn expire_down(self: &Arc<Self>) {
        let expired: Vec<String> = {
            let st = self.lock();
            st.down
                .iter()
                .filter(|(_, t)| t.elapsed() > MAX_DOWN)
                .map(|(k, _)| k.clone())
                .collect()
        };
        for id in expired {
            log::warn!("transferencias: la sesión {id} no se reconectó a tiempo");
            self.session_closed(&id);
        }
    }
}
