//! Comandos Tauri de las llaves SSH locales: buscan `~/.ssh` y hacen la E/S fuera del hilo async.

use zeroize::Zeroizing;

use super::{generate_ed25519, list_public_keys, ssh_dir, GeneratedKey, LocalPublicKey};
use crate::error::{AppError, AppResult};

/// Llaves públicas válidas de ~/.ssh (las mismas que `gh_local_pubkeys`).
#[tauri::command]
pub async fn local_ssh_public_keys() -> AppResult<Vec<LocalPublicKey>> {
    let dir = ssh_dir()?;
    tokio::task::spawn_blocking(move || list_public_keys(&dir))
        .await
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Genera ~/.ssh/<name> (ed25519, frase opcional) y devuelve la parte pública.
#[tauri::command]
pub async fn local_ssh_generate_key(
    name: String,
    comment: String,
    passphrase: Option<String>,
) -> AppResult<GeneratedKey> {
    let dir = ssh_dir()?;
    let passphrase = Zeroizing::new(passphrase.unwrap_or_default());
    tokio::task::spawn_blocking(move || generate_ed25519(&dir, name.trim(), comment.trim(), &passphrase))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}
