//! «Sincronizar carpeta»: une una carpeta del PC con una del servidor y sube sola cada cosa que
//! se guarda en el PC (una vía: PC → servidor).
//!
//! - `filter`: qué no se sincroniza (fijos, `.sshorusignore`, lista del diálogo).
//! - `snapshot`: foto de la carpeta del PC y diferencias; `debounce`: agrupar ráfagas.
//! - `plan`: comparación inicial y seguridad de los borrados; `remote`: leer y borrar en el servidor.
//! - `runner`: el vigilante de cada sincronización (sondeo); `hub`: las activas (sin Tauri).
//! - `saved`: las guardadas por servidor (`folder_syncs.json`); `commands`: comandos Tauri.
//!
//! Las subidas van por el motor de transferencias (`transfer::Engine::upload_files`): se ven en
//! el panel de transferencias y se reanudan solas si la conexión se recupera. Una sincronización
//! vive mientras su conexión esté abierta.

pub mod commands;
mod debounce;
mod filter;
mod hub;
mod model;
mod plan;
mod remote;
mod runner;
pub mod saved;
mod snapshot;
#[cfg(test)]
mod tests;

use std::sync::{Arc, OnceLock};

use futures::future::BoxFuture;
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::error::{AppError, AppResult};
use crate::sftp::SftpStore;
use crate::ssh::{SessionStore, SshSession};
use crate::transfer::{Engine, TransferManager};
use crate::types::{SessionClosed, EV_SESSION_CLOSED};
use hub::{Hub, SyncEnv};

/// Payload: `Vec<SyncInfo>` con todas las sincronizaciones activas.
pub const EV_FOLDER_SYNC: &str = "folder-sync://list";

struct TauriEnv {
    app: AppHandle,
}

impl SyncEnv for TauriEnv {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>> {
        Box::pin(async move {
            match self.app.try_state::<SessionStore>() {
                Some(store) => store.get(id).await,
                None => Err(AppError::SessionNotFound(id.to_string())),
            }
        })
    }

    fn sftp(&self) -> &SftpStore {
        self.app.state::<SftpStore>().inner()
    }

    fn engine(&self) -> Arc<Engine> {
        self.app.state::<TransferManager>().engine(&self.app)
    }

    fn emit(&self, list: Vec<model::SyncInfo>) {
        if let Err(e) = self.app.emit(EV_FOLDER_SYNC, list) {
            log::warn!("no se pudo emitir el estado de las sincronizaciones: {e}");
        }
    }
}

/// Estado global. Se crea con el primer comando (necesita el AppHandle).
#[derive(Default)]
pub struct FolderSyncManager {
    hub: OnceLock<Arc<Hub>>,
}

impl FolderSyncManager {
    fn hub(&self, app: &AppHandle) -> Arc<Hub> {
        self.hub
            .get_or_init(|| {
                let hub = Hub::new(Arc::new(TauriEnv { app: app.clone() }));
                let weak = Arc::downgrade(&hub);
                app.listen_any(EV_SESSION_CLOSED, move |ev| {
                    let Ok(p) = serde_json::from_str::<SessionClosed>(ev.payload()) else { return };
                    if let Some(hub) = weak.upgrade() {
                        hub.session_closed(&p.session_id);
                    }
                });
                hub
            })
            .clone()
    }
}
