//! El token del servicio de IA: vive en la bóveda o en el llavero con el id `ai-token`.

use serde::Serialize;

use super::AI_TOKEN_USER;
use crate::error::{AppError, AppResult};
use crate::storage::secrets;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub has_token: bool,
    /// La bóveda está bloqueada: no se puede leer el token.
    pub locked: bool,
}

/// Hay token guardado, o la bóveda está bloqueada y no se puede saber.
pub async fn status() -> AppResult<AiStatus> {
    match token().await {
        Ok(t) => Ok(AiStatus { has_token: t.is_some_and(|t| !t.is_empty()), locked: false }),
        Err(AppError::Locked) => Ok(AiStatus { has_token: false, locked: true }),
        Err(e) => Err(e),
    }
}

/// Guarda el token (None o vacío lo borra). Va a la bóveda si existe; si no, al llavero.
pub async fn set_token(token: Option<String>) -> AppResult<()> {
    tokio::task::spawn_blocking(move || match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => secrets::set_secret(AI_TOKEN_USER, &t),
        None => secrets::delete_secret(AI_TOKEN_USER),
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

pub(super) async fn token() -> AppResult<Option<String>> {
    tokio::task::spawn_blocking(|| secrets::get_secret(AI_TOKEN_USER))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}
