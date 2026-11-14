//! Llaves PRIVADAS de ~/.ssh de este equipo: detectarlas para el formulario del servidor y
//! Ajustes → Llaves SSH. Solo se devuelve su ruta, su tipo y la parte pública: el secreto no sale
//! de aquí. (Crear llaves y listar las `.pub` está en `localkeys`.)

mod comment;
mod detect;
#[cfg(test)]
mod tests;

use serde::Serialize;

use crate::error::{AppError, AppResult};

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
    tokio::task::spawn_blocking(move || LocalKeys {
        keys: list_private_keys(&dir),
        dir: dir.to_string_lossy().into_owned(),
        default_comment: comment::default_comment(),
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))
}
