//! El secreto guardado de un servidor (bóveda o llavero) al conectar o probar la conexión.

use crate::error::{AppError, AppResult};
use crate::storage::secrets;

pub(super) fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty())
}

/// Secreto guardado (bóveda o llavero). Si SSHorus está bloqueado devuelve `Locked` (la interfaz
/// pide el PIN); otros fallos del llavero solo se registran y se pide la contraseña.
pub(super) async fn keyring_get(profile_id: &str) -> AppResult<Option<String>> {
    let id = profile_id.to_string();
    match tokio::task::spawn_blocking(move || secrets::get_secret(&id)).await {
        Ok(Ok(v)) => Ok(non_empty(v)),
        Ok(Err(AppError::Locked)) => Err(AppError::Locked),
        Ok(Err(e)) => {
            log::warn!("llavero: no se pudo leer el secreto de {profile_id}: {e}");
            Ok(None)
        }
        Err(e) => {
            log::warn!("llavero: tarea fallida: {e}");
            Ok(None)
        }
    }
}

/// Guarda el secreto. Devuelve si quedó guardado.
pub(super) async fn keyring_set(profile_id: &str, secret: String) -> bool {
    let id = profile_id.to_string();
    match tokio::task::spawn_blocking(move || secrets::set_secret(&id, &secret)).await {
        Ok(Ok(())) => true,
        Ok(Err(e)) => {
            log::warn!("llavero: no se pudo guardar el secreto de {profile_id}: {e}");
            false
        }
        Err(e) => {
            log::warn!("llavero: tarea fallida: {e}");
            false
        }
    }
}
