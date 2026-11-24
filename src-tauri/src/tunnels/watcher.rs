//! Vigilante de túneles: seguimiento de sesiones cerradas, reconexión remota, autoStart y métricas.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use futures::future::join_all;

use crate::ssh::SshSession;
use crate::tunnels::forward::{close_remote, open_remote};
use crate::tunnels::remote;
use crate::tunnels::types::{TunnelKind, TunnelState, TunnelStatus};

use super::manager::{RunKey, Sessions, TunnelManager};

/// Intentos (uno por segundo) de reabrir un túnel remoto tras reconectar.
const MAX_REBIND: u32 = 30;
const MSG_WAITING: &str = "Esperando a que vuelva la conexión…";

impl TunnelManager {
    /// Una vuelta del vigilante.
    pub async fn tick(&self, env: &Sessions) {
        let Ok(store) = env.store() else { return };

        // 1. Túneles en marcha frente al estado de su sesión.
        type Snap = (RunKey, u64, TunnelKind, TunnelState, Option<usize>, bool);
        let snapshot: Vec<Snap> = self
            .lock()
            .iter()
            .map(|(k, r)| {
                let ptr = r.remote.as_ref().map(|b| b.session.as_ptr() as usize);
                (k.clone(), r.epoch, r.def.kind, r.state, ptr, r.busy)
            })
            .collect();
        let mut rebinds = Vec::new();
        for (key, epoch, kind, state, bound, busy) in snapshot {
            let alive = store
                .cancel_token(&key.0)
                .await
                .is_some_and(|c| !c.is_cancelled());
            if !alive {
                self.stop_key(env, &key, Some("La conexión se cerró".into()))
                    .await;
                continue;
            }
            match store.get(&key.0).await {
                Ok(sess) => match kind {
                    TunnelKind::Local | TunnelKind::Socks => {
                        if state == TunnelState::Waiting
                            && let Some(st) = self.set(&key, epoch, |r| {
                                r.state = TunnelState::Active;
                                r.message = None;
                            })
                        {
                            env.emit(&st);
                        }
                    }
                    TunnelKind::Remote => {
                        let moved = bound != Some(Arc::as_ptr(&sess) as usize);
                        if matches!(state, TunnelState::Active | TunnelState::Waiting)
                            && !busy
                            && moved
                        {
                            self.set(&key, epoch, |r| r.busy = true);
                            rebinds.push((key, epoch, sess));
                        }
                    }
                },
                Err(_) => {
                    if state == TunnelState::Active
                        && let Some(st) = self.set(&key, epoch, |r| {
                            r.state = TunnelState::Waiting;
                            r.message = Some(MSG_WAITING.into());
                        })
                    {
                        env.emit(&st);
                    }
                }
            }
        }
        join_all(
            rebinds
                .into_iter()
                .map(|(k, g, s)| self.rebind(env, k, g, s)),
        )
        .await;

        // 2. Arranque automático en las sesiones nuevas.
        let infos = store.list().await;
        let fresh: Vec<_> = {
            let mut seen = self.seen_lock();
            infos
                .into_iter()
                .filter(|i| seen.insert(i.id.clone()))
                .collect()
        };
        let mut starts = Vec::new();
        for info in &fresh {
            for def in self
                .defs
                .list(&info.profile_id)
                .into_iter()
                .filter(|d| d.auto_start)
            {
                if self.running_anywhere(&def.id) {
                    continue;
                }
                let sid = info.id.clone();
                starts.push(async move {
                    if let Err(e) = self.start(env, &sid, &def.id).await {
                        log::info!("túnel «{}»: arranque automático fallido: {e}", def.name);
                    }
                });
            }
        }
        join_all(starts).await;
        let seen_ids: Vec<String> = self.seen_lock().iter().cloned().collect();
        for id in seen_ids {
            if store.cancel_token(&id).await.is_none() {
                self.seen_lock().remove(&id);
            }
        }

        // 3. Contadores que cambiaron.
        let changed: Vec<TunnelStatus> = self
            .lock()
            .iter()
            .filter(|(_, r)| r.stats.dirty.swap(false, Ordering::Relaxed))
            .map(|(k, r)| r.status(k))
            .collect();
        for st in &changed {
            env.emit(st);
        }
    }

    /// Reabre un túnel remoto en la conexión nueva (tras reconectar).
    async fn rebind(&self, env: &Sessions, key: RunKey, epoch: u64, sess: Arc<SshSession>) {
        let taken = {
            let mut map = self.lock();
            map.get_mut(&key).filter(|r| r.epoch == epoch).map(|r| {
                (
                    r.def.clone(),
                    r.stats.clone(),
                    r.cancel.clone(),
                    r.remote.take(),
                    r.bound_port,
                )
            })
        };
        let Some((def, stats, cancel, old, port)) = taken else {
            return;
        };
        if let Some(old) = old {
            remote::unregister(&old.key);
        }
        let want = port.map(u32::from).unwrap_or(u32::from(def.bind_port));
        let res = open_remote(&sess, &def, want, stats, cancel).await;
        let mut leftover = None;
        let st = {
            let mut map = self.lock();
            match map.get_mut(&key).filter(|r| r.epoch == epoch) {
                Some(r) => {
                    r.busy = false;
                    match res {
                        Ok((p, rb)) => {
                            r.state = TunnelState::Active;
                            r.message = None;
                            r.bound_port = Some(p);
                            r.remote = Some(rb);
                            r.retries = 0;
                        }
                        Err(e) => {
                            r.retries += 1;
                            if r.retries >= MAX_REBIND {
                                r.state = TunnelState::Error;
                                r.message = Some(e.to_string());
                            } else {
                                r.state = TunnelState::Waiting;
                                r.message =
                                    Some(format!("Reabriendo el puerto en el servidor… ({e})"));
                            }
                        }
                    }
                    Some(r.status(&key))
                }
                None => {
                    leftover = res.ok().map(|(_, rb)| rb);
                    None
                }
            }
        };
        if let Some(rb) = leftover {
            close_remote(rb).await;
        }
        if let Some(st) = st {
            env.emit(&st);
        }
    }
}
