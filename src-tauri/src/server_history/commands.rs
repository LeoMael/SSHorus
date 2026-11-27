//! Comandos Tauri del historial por servidor: envoltorios finos sobre `store` y `redact`.
//! Solo los usa la interfaz: el servidor MCP no tiene ninguna herramienta que lea este historial.

use zeroize::Zeroizing;

use super::model::HistoryEvent;
use super::redact::redact_event;
use super::store::HistoryStore;
use crate::error::{AppError, AppResult};
use crate::storage::secrets;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interrumpida: {e}")))?
}

/// Guarda una entrada, con las contraseñas guardadas del servidor y las llaves tapadas.
#[tauri::command]
pub async fn server_history_append(server_id: String, event: HistoryEvent) -> AppResult<HistoryEvent> {
    blocking(move || {
        // Si la bóveda está bloqueada o no hay llavero, se tapa igual por forma (`redact`).
        let known: Vec<Zeroizing<String>> = [server_id.clone(), secrets::sudo_id(&server_id)]
            .iter()
            .filter_map(|id| secrets::get_secret(id).ok().flatten().map(Zeroizing::new))
            .collect();
        let refs: Vec<&str> = known.iter().map(|s| s.as_str()).collect();
        let mut ev = event;
        redact_event(&mut ev, &refs);
        HistoryStore::system().append(&server_id, ev)
    })
    .await
}

/// Lo guardado de un servidor, lo más nuevo primero.
#[tauri::command]
pub async fn server_history_list(server_id: String) -> AppResult<Vec<HistoryEvent>> {
    blocking(move || HistoryStore::system().list(&server_id)).await
}

/// Borra lo guardado de un servidor (no toca Administración, el asistente ni las auditorías).
#[tauri::command]
pub async fn server_history_clear(server_id: String) -> AppResult<()> {
    blocking(move || HistoryStore::system().clear(&server_id)).await
}
