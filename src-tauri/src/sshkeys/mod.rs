//! Llaves PRIVADAS de ~/.ssh de este equipo: detectarlas para el formulario del servidor y
//! Ajustes → Llaves SSH. Solo se devuelve su ruta, su tipo y la parte pública: el secreto no sale
//! de aquí, más los `Host` de ~/.ssh/config que la usan. (Crear llaves y listar las `.pub` está en
//! `localkeys`.)

mod comment;
mod detect;
mod hosts;
#[cfg(test)]
mod tests;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::storage::ssh_config::{key_hosts::key_hosts, SshEnv};

pub use detect::{LocalPrivateKey, list_private_keys};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalKeys {
    /// Carpeta donde se buscó (~/.ssh).
    pub dir: String,
    pub keys: Vec<LocalPrivateKey>,
    /// Comentario sugerido para una llave nueva: `usuario@equipo`.
    pub default_comment: String,
}

/// Llaves privadas de ~/.ssh y el comentario sugerido para crear una.
#[tauri::command]
pub async fn local_ssh_private_keys() -> AppResult<LocalKeys> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Io("No se encontró la carpeta personal".into()))?;
    let dir = home.join(".ssh");
    tokio::task::spawn_blocking(move || {
        let mut keys = list_private_keys(&dir);
        // Sin ~/.ssh/config legible, las llaves se listan igual (sin sus `Host`).
        if let Ok(env) = SshEnv::user() {
            hosts::attach_config_hosts(&mut keys, &key_hosts(&env));
        }
        LocalKeys { keys, dir: dir.to_string_lossy().into_owned(), default_comment: comment::default_comment() }
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))
}
