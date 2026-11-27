//! Las sincronizaciones activas (sin Tauri): crear con la comparación inicial, pausar, quitar
//! y avisar a la interfaz de cada cambio de estado.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use futures::future::BoxFuture;
use tokio_util::sync::CancellationToken;

use super::filter::IgnoreRules;
use super::model::{SyncInfo, SyncPreview, SyncSpec, SyncState};
use super::plan::{compare, remote_path};
use super::remote::list_tree;
use super::runner::{self, Runner};
use super::snapshot::{rules_for, scan, Snapshot, MAX_FILES};
use crate::error::{AppError, AppResult};
use crate::sftp::SftpStore;
use crate::ssh::SshSession;
use crate::transfer::{Conflict, Engine, UploadItem};

/// Lo que la sincronización necesita del exterior (Tauri en la app, un doble en las pruebas).
pub trait SyncEnv: Send + Sync + 'static {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>>;
    fn sftp(&self) -> &SftpStore;
    fn engine(&self) -> Arc<Engine>;
    /// La lista entera tras cualquier cambio.
    fn emit(&self, list: Vec<SyncInfo>);
}

struct Slot {
    info: SyncInfo,
    token: CancellationToken,
    paused: Arc<AtomicBool>,
}

pub struct Hub {
    pub(super) env: Arc<dyn SyncEnv>,
    slots: Mutex<Vec<Slot>>,
}

/// Qué subir al empezar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartOptions {
    /// Subir lo que falta o es más nuevo en el PC.
    pub upload: bool,
    /// Subir también lo que es más nuevo en el servidor (el usuario lo confirmó).
    pub overwrite_newer: bool,
    pub remembered: bool,
}

/// Normaliza y comprueba las dos carpetas.
pub fn check_spec(mut spec: SyncSpec) -> AppResult<SyncSpec> {
    spec.local_dir = spec.local_dir.trim().to_string();
    let remote = spec.remote_dir.trim().trim_end_matches('/').to_string();
    if !spec.remote_dir.trim().starts_with('/') {
        return Err(AppError::Invalid("La carpeta del servidor debe ser una ruta completa (empieza por /)".into()));
    }
    if remote.is_empty() {
        return Err(AppError::Invalid("Elige una carpeta concreta del servidor, no la raíz (/)".into()));
    }
    spec.remote_dir = remote;
    if !Path::new(&spec.local_dir).is_dir() {
        return Err(AppError::Invalid("La carpeta de tu PC no existe".into()));
    }
    spec.ignore = spec.ignore.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    Ok(spec)
}

impl Hub {
    pub fn new(env: Arc<dyn SyncEnv>) -> Arc<Hub> {
        Arc::new(Hub { env, slots: Mutex::new(Vec::new()) })
    }

    fn lock(&self) -> MutexGuard<'_, Vec<Slot>> {
        self.slots.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn list(&self) -> Vec<SyncInfo> {
        self.lock().iter().map(|s| s.info.clone()).collect()
    }

    fn emit(&self) {
        self.env.emit(self.list());
    }

    /// Foto del PC y comparación con el servidor.
    async fn compare_now(&self, ssh: &Arc<SshSession>, spec: &SyncSpec) -> AppResult<(Snapshot, IgnoreRules, SyncPreview)> {
        let root = PathBuf::from(&spec.local_dir);
        let rules = rules_for(&root, &spec.ignore);
        let (r2, rules2) = (root.clone(), rules.clone());
        let snap = tokio::task::spawn_blocking(move || scan(&r2, &rules2, MAX_FILES))
            .await
            .map_err(|_| AppError::Io("No se pudo leer la carpeta de tu PC".into()))?
            .map_err(AppError::Io)?;
        let remote = list_tree(self.env.sftp(), ssh, &spec.remote_dir, &rules, MAX_FILES * 2).await?;
        let preview = compare(&snap, &remote);
        Ok((snap, rules, preview))
    }

    pub async fn preview(&self, session_id: &str, spec: SyncSpec) -> AppResult<SyncPreview> {
        let spec = check_spec(spec)?;
        let ssh = self.env.session(session_id).await?;
        Ok(self.compare_now(&ssh, &spec).await?.2)
    }

    /// Une las carpetas: sube lo que toca según `opts` y empieza a vigilar.
    pub async fn start(self: &Arc<Self>, session_id: &str, spec: SyncSpec, opts: StartOptions) -> AppResult<SyncInfo> {
        let spec = check_spec(spec)?;
        if self.lock().iter().any(|s| s.info.session_id == session_id && s.info.spec.remote_dir == spec.remote_dir) {
            return Err(AppError::Invalid("Esa carpeta del servidor ya está sincronizada en esta conexión".into()));
        }
        let ssh = self.env.session(session_id).await?;
        let (snap, rules, preview) = self.compare_now(&ssh, &spec).await?;

        let mut first = Vec::new();
        if opts.upload {
            first.extend(preview.to_upload.iter());
            if opts.overwrite_newer {
                first.extend(preview.remote_newer.iter());
            }
        }
        let root = PathBuf::from(&spec.local_dir);
        let items: Vec<UploadItem> = first
            .iter()
            .map(|p| UploadItem {
                local: root.join(&p.rel),
                remote: remote_path(&spec.remote_dir, &p.rel),
                name: p.rel.clone(),
                size: p.size,
            })
            .collect();
        let rels: Vec<String> = first.iter().map(|p| p.rel.clone()).collect();
        let inflight = if items.is_empty() {
            Vec::new()
        } else {
            let (_, ids) = self.env.engine().upload_files(session_id, items, Conflict::Overwrite);
            rels.into_iter().zip(ids).collect()
        };

        let info = SyncInfo {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            spec: spec.clone(),
            state: if inflight.is_empty() { SyncState::Idle } else { SyncState::Uploading },
            pending: inflight.len() as u32,
            files: snap.files.len() as u32,
            last_file: None,
            last_at: None,
            error: None,
            warning: snap.truncated.then(runner::too_many_warning),
            remembered: opts.remembered,
        };
        let token = CancellationToken::new();
        let paused = Arc::new(AtomicBool::new(false));
        self.lock().push(Slot { info: info.clone(), token: token.clone(), paused: paused.clone() });
        self.emit();
        let r = Runner::new(self.clone(), &info, root, rules, snap, inflight);
        tokio::spawn(runner::run(r, token, paused));
        Ok(info)
    }

    pub fn set_paused(&self, id: &str, paused: bool) -> AppResult<()> {
        {
            let mut slots = self.lock();
            let s = slots
                .iter_mut()
                .find(|s| s.info.id == id)
                .ok_or_else(|| AppError::NotFound("La sincronización ya no existe".into()))?;
            s.paused.store(paused, Ordering::Relaxed);
            s.info.state = if paused { SyncState::Paused } else { SyncState::Uploading };
        }
        self.emit();
        Ok(())
    }

    /// Deja de vigilar (lo que ya está en la cola de transferencias termina igual).
    pub fn remove(&self, id: &str) -> Option<SyncInfo> {
        let removed = {
            let mut slots = self.lock();
            let i = slots.iter().position(|s| s.info.id == id)?;
            let s = slots.remove(i);
            s.token.cancel();
            s.info
        };
        self.emit();
        Some(removed)
    }

    /// La conexión se cerró del todo: sus sincronizaciones terminan.
    pub fn session_closed(&self, session_id: &str) {
        let had = {
            let mut slots = self.lock();
            let before = slots.len();
            slots.retain(|s| {
                let keep = s.info.session_id != session_id;
                if !keep {
                    s.token.cancel();
                }
                keep
            });
            slots.len() != before
        };
        if had {
            self.emit();
        }
    }

    /// Cambia el estado de una sincronización (si sigue activa y no está en pausa) y avisa si cambió.
    pub(super) fn update(&self, id: &str, f: impl FnOnce(&mut SyncInfo)) {
        let changed = {
            let mut slots = self.lock();
            let Some(s) = slots.iter_mut().find(|s| s.info.id == id) else { return };
            let before = s.info.clone();
            f(&mut s.info);
            if s.paused.load(Ordering::Relaxed) {
                s.info.state = SyncState::Paused;
            }
            s.info != before
        };
        if changed {
            self.emit();
        }
    }
}
