//! Túneles en marcha por sesión + vigilante (cierre de la sesión, reconexión y arranque automático).
//!
//! - Local / SOCKS: cada conexión entrante pide la sesión ACTUAL al `SessionStore`, así que tras
//!   una reconexión (mismo sessionId, conexión nueva) siguen funcionando sin reabrir el puerto.
//! - Remoto: el puerto vive en el servidor; tras reconectar hay que pedirlo otra vez (`rebind`).
//! - El vigilante (`tick`, cada segundo): para los túneles de sesiones cerradas, marca "esperando"
//!   durante la reconexión, reabre los remotos, arranca los `autoStart` de las sesiones nuevas y
//!   emite los contadores que cambiaron (como mucho una vez por segundo).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures::future::join_all;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::ssh::{SessionStore, SshSession};
use crate::tunnels::forward::{close_remote, open_listener, open_remote, RemoteBinding};
use crate::tunnels::io::Stats;
use crate::tunnels::remote;
use crate::tunnels::store::DefStore;
use crate::tunnels::types::{EV_TUNNEL_STATUS, TunnelDef, TunnelKind, TunnelState, TunnelStatus};

/// Cada cuánto mira el vigilante.
pub const TICK: Duration = Duration::from_secs(1);
/// Intentos (uno por segundo) de reabrir un túnel remoto tras reconectar.
const MAX_REBIND: u32 = 30;

const MSG_WAITING: &str = "Esperando a que vuelva la conexión…";

/// De dónde salen las sesiones y a dónde van los avisos.
#[derive(Clone)]
pub enum Sessions {
    App(AppHandle),
    #[cfg(test)]
    Direct(Arc<SessionStore>),
}

impl Sessions {
    fn store(&self) -> AppResult<&SessionStore> {
        match self {
            Sessions::App(app) => app
                .try_state::<SessionStore>()
                .map(|s| s.inner())
                .ok_or_else(|| AppError::Invalid("El motor SSH no está listo".into())),
            #[cfg(test)]
            Sessions::Direct(s) => Ok(s),
        }
    }

    pub(super) async fn session(&self, id: &str) -> AppResult<Arc<SshSession>> {
        self.store()?.get(id).await
    }

    fn emit(&self, st: &TunnelStatus) {
        match self {
            Sessions::App(app) => {
                let _ = app.emit(EV_TUNNEL_STATUS, st);
            }
            #[cfg(test)]
            Sessions::Direct(_) => {}
        }
    }
}

type RunKey = (String, String);

struct Running {
    epoch: u64,
    def: TunnelDef,
    state: TunnelState,
    message: Option<String>,
    stats: Arc<Stats>,
    cancel: CancellationToken,
    bound_port: Option<u16>,
    started_at: u64,
    remote: Option<RemoteBinding>,
    /// Reapertura remota en curso.
    busy: bool,
    retries: u32,
}

impl Running {
    fn status(&self, key: &RunKey) -> TunnelStatus {
        TunnelStatus {
            session_id: key.0.clone(),
            tunnel_id: key.1.clone(),
            state: self.state,
            message: self.message.clone(),
            last_error: self.stats.last_error(),
            connections: self.stats.open.load(Ordering::Relaxed),
            total_connections: self.stats.total.load(Ordering::Relaxed),
            bytes_up: self.stats.up.load(Ordering::Relaxed),
            bytes_down: self.stats.down.load(Ordering::Relaxed),
            bound_port: self.bound_port,
            started_at: self.started_at,
        }
    }
}

fn stopped(key: &RunKey, message: Option<String>) -> TunnelStatus {
    TunnelStatus {
        session_id: key.0.clone(),
        tunnel_id: key.1.clone(),
        state: TunnelState::Stopped,
        message,
        last_error: None,
        connections: 0,
        total_connections: 0,
        bytes_up: 0,
        bytes_down: 0,
        bound_port: None,
        started_at: 0,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct TunnelManager {
    pub defs: DefStore,
    running: Mutex<HashMap<RunKey, Running>>,
    /// Sesiones ya vistas por el arranque automático.
    seen: Mutex<HashSet<String>>,
    next_epoch: AtomicU64,
    watcher: AtomicBool,
}

impl TunnelManager {
    pub fn load() -> Self {
        Self::with_store(DefStore::load())
    }

    pub fn with_store(defs: DefStore) -> Self {
        Self {
            defs,
            running: Mutex::new(HashMap::new()),
            seen: Mutex::new(HashSet::new()),
            next_epoch: AtomicU64::new(1),
            watcher: AtomicBool::new(false),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<RunKey, Running>> {
        self.running.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn seen_lock(&self) -> MutexGuard<'_, HashSet<String>> {
        self.seen.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Lanza el vigilante (una sola vez).
    pub fn start_watcher(&self, app: AppHandle) {
        if self.watcher.swap(true, Ordering::SeqCst) {
            return;
        }
        tauri::async_runtime::spawn(async move {
            let env = Sessions::App(app.clone());
            loop {
                tokio::time::sleep(TICK).await;
                if let Some(m) = app.try_state::<TunnelManager>() {
                    m.tick(&env).await;
                }
            }
        });
    }

    /// Estado de los túneles en marcha (o con error) de una sesión.
    pub fn statuses(&self, session_id: &str) -> Vec<TunnelStatus> {
        self.lock()
            .iter()
            .filter(|(k, _)| k.0 == session_id)
            .map(|(k, r)| r.status(k))
            .collect()
    }

    fn status_of(&self, key: &RunKey) -> Option<TunnelStatus> {
        self.lock().get(key).map(|r| r.status(key))
    }

    fn emit_key(&self, env: &Sessions, key: &RunKey) {
        if let Some(st) = self.status_of(key) {
            env.emit(&st);
        }
    }

    /// Activa un túnel guardado en una sesión conectada.
    pub async fn start(
        &self,
        env: &Sessions,
        session_id: &str,
        tunnel_id: &str,
    ) -> AppResult<TunnelStatus> {
        let def = self.defs.get(tunnel_id)?;
        let session = env
            .session(session_id)
            .await
            .map_err(|_| AppError::Invalid("Conéctate al servidor para activar el túnel".into()))?;
        if session.info.profile_id != def.profile_id {
            return Err(AppError::Invalid(
                "Este túnel pertenece a otro servidor".into(),
            ));
        }
        let key: RunKey = (session_id.to_string(), tunnel_id.to_string());
        let (epoch, stats, cancel, old) = {
            let mut map = self.lock();
            if let Some(r) = map.get(&key)
                && r.state != TunnelState::Error
            {
                return Ok(r.status(&key));
            }
            let old = map.remove(&key);
            let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);
            let stats = Arc::new(Stats::default());
            let cancel = CancellationToken::new();
            map.insert(
                key.clone(),
                Running {
                    epoch,
                    def: def.clone(),
                    state: TunnelState::Starting,
                    message: None,
                    stats: stats.clone(),
                    cancel: cancel.clone(),
                    bound_port: None,
                    started_at: now_ms(),
                    remote: None,
                    busy: false,
                    retries: 0,
                },
            );
            (epoch, stats, cancel, old)
        };
        if let Some(old) = old {
            release(old).await;
        }
        self.emit_key(env, &key);

        let res = match def.kind {
            TunnelKind::Local | TunnelKind::Socks => {
                open_listener(env, session_id, &def, stats, cancel.clone())
                    .await
                    .map(|p| (p, None))
            }
            TunnelKind::Remote => open_remote(
                &session,
                &def,
                u32::from(def.bind_port),
                stats,
                cancel.clone(),
            )
            .await
            .map(|(p, rb)| (p, Some(rb))),
        };

        let outcome = {
            let mut map = self.lock();
            match (res, map.get_mut(&key).filter(|r| r.epoch == epoch)) {
                (Ok((port, rb)), Some(r)) => {
                    r.state = TunnelState::Active;
                    r.bound_port = Some(port);
                    r.remote = rb;
                    Ok(Ok(r.status(&key)))
                }
                (Ok((_, rb)), None) => Ok(Err(rb)),
                (Err(e), Some(r)) => {
                    r.state = TunnelState::Error;
                    r.message = Some(e.to_string());
                    Err(e)
                }
                (Err(e), None) => Err(e),
            }
        };
        match outcome {
            Ok(Ok(st)) => {
                log::info!("túnel «{}» activo en la sesión {session_id}", def.name);
                env.emit(&st);
                Ok(st)
            }
            // Lo pararon mientras arrancaba: deshacer.
            Ok(Err(rb)) => {
                cancel.cancel();
                if let Some(rb) = rb {
                    close_remote(rb).await;
                }
                Err(AppError::Canceled)
            }
            Err(e) => {
                self.emit_key(env, &key);
                Err(e)
            }
        }
    }

    /// Para un túnel (no es error si no estaba en marcha).
    pub async fn stop(&self, env: &Sessions, session_id: &str, tunnel_id: &str) {
        let key: RunKey = (session_id.to_string(), tunnel_id.to_string());
        self.stop_key(env, &key, None).await;
    }

    async fn stop_key(&self, env: &Sessions, key: &RunKey, message: Option<String>) {
        let removed = self.lock().remove(key);
        if let Some(r) = removed {
            log::info!("túnel «{}» parado en la sesión {}", r.def.name, key.0);
            release(r).await;
        }
        env.emit(&stopped(key, message));
    }

    /// Para un túnel en todas las sesiones (al borrarlo).
    pub async fn stop_everywhere(&self, env: &Sessions, tunnel_id: &str) {
        let keys: Vec<RunKey> = self
            .lock()
            .keys()
            .filter(|k| k.1 == tunnel_id)
            .cloned()
            .collect();
        for k in keys {
            self.stop_key(env, &k, None).await;
        }
    }

    /// Tras editar un túnel: reinicia las instancias en marcha si cambió algo de la conexión.
    pub async fn restart_changed(&self, env: &Sessions, def: &TunnelDef) {
        let same = |a: &TunnelDef| {
            a.kind == def.kind
                && a.bind_host == def.bind_host
                && a.bind_port == def.bind_port
                && a.dest_host == def.dest_host
                && a.dest_port == def.dest_port
        };
        let keys: Vec<RunKey> = {
            let mut map = self.lock();
            let mut out = Vec::new();
            for (k, r) in map.iter_mut().filter(|(k, _)| k.1 == def.id) {
                if same(&r.def) {
                    r.def = def.clone();
                } else {
                    out.push(k.clone());
                }
            }
            out
        };
        for k in keys {
            self.stop_key(env, &k, None).await;
            if let Err(e) = self.start(env, &k.0, &k.1).await {
                log::info!("túnel {}: no se pudo reiniciar tras editarlo: {e}", k.1);
            }
        }
    }

    fn running_anywhere(&self, tunnel_id: &str) -> bool {
        self.lock()
            .iter()
            .any(|(k, r)| k.1 == tunnel_id && r.state != TunnelState::Error)
    }

    fn set(&self, key: &RunKey, epoch: u64, f: impl FnOnce(&mut Running)) -> Option<TunnelStatus> {
        let mut map = self.lock();
        let r = map.get_mut(key).filter(|r| r.epoch == epoch)?;
        f(r);
        Some(r.status(key))
    }

    /// Una vuelta del vigilante.
    pub async fn tick(&self, env: &Sessions) {
        let Ok(store) = env.store() else { return };

        // 1. Túneles en marcha frente al estado de su sesión.
        // Puntero de la sesión como número: solo se compara (y así el futuro es `Send`).
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
            // La conexión vieja murió: basta con olvidar la ruta.
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

/// Suelta todo lo de un túnel: conexiones, escucha y puerto remoto.
async fn release(r: Running) {
    r.cancel.cancel();
    if let Some(rb) = r.remote {
        close_remote(rb).await;
    }
}
