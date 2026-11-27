//! Motor de transferencias independiente de Tauri (probado directamente en los tests).
//!
//! - Una cola por sesión, en orden de llegada; hasta `concurrency()` trabajos a la vez
//!   POR SESIÓN (1..=8): dos servidores trabajan en paralelo con N cada uno.
//! - Cada trabajo toma prestado un canal SFTP de la reserva de su sesión.
//! - Política de conflictos (`Conflict`) leída al crear el lote; lo omitido queda `Skipped`.
//! - Enlaces simbólicos dentro de carpetas se recrean (nunca se siguen).
//! - Si la conexión se cae y se espera reconexión, los trabajos vuelven a la cola de su
//!   sesión ("Esperando reconexión…") sin gastar reintentos; `resume_session` los reanuda
//!   desde lo ya confirmado. `session_closed` (pérdida definitiva) los deja en error.
//! - El progreso vive en atómicos (`Ctrl`); un emisor cada ~200 ms calcula velocidades
//!   y envía SOLO los trabajos que cambiaron.
//!
//! Partes (`engine/`): `state` (tipos de la cola), `batch` (lotes y altas), `control`
//! (pausar / reanudar / cancelar / reintentar), `conflicts` (preguntas), `walk_upload` y
//! `walk_download` (recorridos), `scheduler` (turnos y fin de cada trabajo), `execute`
//! (reintentos), `attempt` (un intento), `links` (destinos y enlaces), `emitter` (progreso) y
//! `direct` (lista de archivos con destino fijo, para «Sincronizar carpeta»).

mod attempt;
mod batch;
mod conflicts;
mod control;
mod direct;
mod emitter;
mod execute;
mod links;
mod scheduler;
mod state;
mod walk_download;
mod walk_upload;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;
use tokio::sync::Notify;

use super::policy::{Conflict, ConflictQuestion};
use super::pool::{Lease, Pools};
use crate::error::AppResult;
use crate::ssh::SshSession;
use crate::types::{TransferJob, TransferStatus};
pub use direct::UploadItem;
use state::{Kind, State};

pub const CLOSED_MSG: &str = "La conexión se cerró";
/// Nota de los trabajos en cola mientras su sesión se reconecta.
pub const WAITING_MSG: &str = "Esperando reconexión…";
const TICK: Duration = Duration::from_millis(200);
const MAX_RETRIES: u32 = 3;
/// Si una sesión caída no se reconecta (ni se cierra) en este tiempo, se da por perdida.
const MAX_DOWN: Duration = Duration::from_secs(300);
/// Revisión periódica en reposo (canales ociosos, sesiones caídas).
const IDLE_CHECK: Duration = Duration::from_secs(30);

/// Lo que el motor necesita del exterior (Tauri en la app, un doble en los tests).
pub trait TransferEnv: Send + Sync + 'static {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>>;
    /// Trabajos simultáneos deseados POR SESIÓN (se recorta a 1..=8).
    fn concurrency(&self) -> usize;
    /// Política de conflictos actual (se lee al crear cada lote).
    fn conflict_policy(&self) -> Conflict;
    /// ¿Se espera una reconexión automática cuando una sesión desaparece?
    fn auto_reconnect(&self) -> bool;
    fn emit_update(&self, jobs: Vec<TransferJob>);
    fn emit_removed(&self, ids: Vec<String>);
    /// Un trabajo choca con un destino existente y la política es "preguntar".
    fn emit_conflict(&self, question: ConflictQuestion);
    /// Preguntas que ya no están pendientes (respondidas en bloque, canceladas o pausadas).
    fn emit_conflict_done(&self, job_ids: Vec<String>);
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct Engine {
    env: Arc<dyn TransferEnv>,
    st: Mutex<State>,
    pools: Pools,
    notify: Notify,
    /// Despierta a los trabajos que esperan (reintento) cuando una sesión vuelve o se cierra.
    resumed: Notify,
    emitter_started: AtomicBool,
}

impl Engine {
    pub fn new(env: Arc<dyn TransferEnv>) -> Arc<Engine> {
        Arc::new(Engine {
            env,
            st: Mutex::new(State {
                order: Vec::new(),
                jobs: HashMap::new(),
                batches: HashMap::new(),
                queues: HashMap::new(),
                running: Vec::new(),
                down: HashMap::new(),
                closed: HashSet::new(),
                questions: HashMap::new(),
                dirty: Vec::new(),
                last_tick: Instant::now(),
            }),
            pools: Pools::default(),
            notify: Notify::new(),
            resumed: Notify::new(),
            emitter_started: AtomicBool::new(false),
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        match self.st.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    // ───────────────────────── API pública ─────────────────────────

    pub fn upload(self: &Arc<Self>, session_id: String, local_paths: Vec<String>, remote_dir: String) -> String {
        let batch_id = uuid::Uuid::new_v4().to_string();
        self.open_batch(&batch_id, self.env.conflict_policy());
        let me = self.clone();
        let b = batch_id.clone();
        tokio::spawn(async move {
            for p in local_paths {
                me.walk_upload_root(&b, &session_id, PathBuf::from(p), &remote_dir).await;
            }
            me.walker_done(&b);
        });
        batch_id
    }

    pub fn download(self: &Arc<Self>, session_id: String, remote_paths: Vec<String>, local_dir: String) -> String {
        let batch_id = uuid::Uuid::new_v4().to_string();
        self.open_batch(&batch_id, self.env.conflict_policy());
        let me = self.clone();
        let b = batch_id.clone();
        let local_dir = PathBuf::from(local_dir);
        tokio::spawn(async move {
            for p in remote_paths {
                me.walk_download_root(&b, &session_id, p, &local_dir).await;
            }
            me.walker_done(&b);
        });
        batch_id
    }

    /// Suelta los canales SFTP de una sesión (se cerró o se va a reconectar).
    pub fn forget_session(&self, session_id: &str) {
        self.pools.drop_session(session_id);
    }

    /// La sesión volvió (mismo id, conexión nueva): los trabajos que esperaban siguen y los
    /// que fallaron por la caída se reintentan desde lo ya confirmado.
    pub fn resume_session(self: &Arc<Self>, session_id: &str) {
        self.pools.drop_session(session_id);
        let ids: Vec<String> = {
            let mut st = self.lock();
            st.down.remove(session_id);
            st.closed.remove(session_id);
            st.order
                .iter()
                .filter(|id| {
                    st.jobs.get(*id).is_some_and(|e| {
                        e.job.session_id == session_id
                            && e.job.status == TransferStatus::Error
                            && e.job.error.as_deref() == Some(CLOSED_MSG)
                            && !matches!(e.kind, Kind::Info)
                    })
                })
                .cloned()
                .collect()
        };
        log::info!("transferencias: sesión {session_id} reconectada; {} trabajos a reanudar", ids.len());
        self.resumed.notify_waiters();
        if ids.is_empty() {
            self.schedule();
        } else {
            self.retry(&ids);
        }
    }

    /// La sesión se perdió definitivamente: lo que esperaba en su cola queda en error
    /// (reintentable si más tarde llegara `resume_session`).
    pub fn session_closed(self: &Arc<Self>, session_id: &str) {
        self.pools.drop_session(session_id);
        {
            let mut st = self.lock();
            st.down.remove(session_id);
            st.closed.insert(session_id.to_string());
            let queued: Vec<String> = st.queues.remove(session_id).map(Vec::from).unwrap_or_default();
            let now = now_ms();
            for id in queued {
                let Some(e) = st.jobs.get_mut(&id) else { continue };
                if e.job.status != TransferStatus::Queued || e.ctrl.is_some() {
                    continue;
                }
                e.job.status = TransferStatus::Error;
                e.job.error = Some(CLOSED_MSG.into());
                e.job.speed = 0.0;
                e.job.finished_at = Some(now);
                st.mark(&id);
            }
        }
        self.resumed.notify_waiters();
        self.kick();
    }

    /// Solo pruebas: canales de la reserva.
    #[cfg(test)]
    pub fn pools(&self) -> &Pools {
        &self.pools
    }

    pub fn list(&self) -> Vec<TransferJob> {
        let st = self.lock();
        st.order
            .iter()
            .filter_map(|id| st.jobs.get(id))
            .map(|e| {
                let mut j = e.job.clone();
                if let Some(c) = &e.ctrl {
                    j.transferred = c.progress.load(Ordering::Relaxed);
                }
                j
            })
            .collect()
    }

    async fn session_lease(&self, session_id: &str) -> Result<(Arc<SshSession>, Lease), String> {
        let session = match self.env.session(session_id).await {
            Ok(s) => s,
            Err(_) => {
                self.pools.drop_session(session_id);
                return Err(CLOSED_MSG.into());
            }
        };
        match self.pools.lease(session_id, &session).await {
            Ok(l) => Ok((session, l)),
            Err(e) => {
                if session.is_closed() {
                    Err(CLOSED_MSG.into())
                } else {
                    Err(format!("No se pudo abrir un canal SFTP: {e}"))
                }
            }
        }
    }
}
