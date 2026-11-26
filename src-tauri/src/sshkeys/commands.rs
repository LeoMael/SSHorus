//! Comando Tauri de las llaves privadas de ~/.ssh.

use super::{local_keys, LocalKeys};
use crate::error::{AppError, AppResult};

/// Llaves privadas de ~/.ssh y el comentario sugerido para crear una.
#[tauri::command]
pub async fn local_ssh_private_keys() -> AppResult<LocalKeys> {
    let dir = crate::localkeys::ssh_dir()?;
    tokio::task::spawn_blocking(move || local_keys(&dir))
        .await
        .map_err(|e| AppError::Io(e.to_string()))
}
