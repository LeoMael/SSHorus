//! Comandos Tauri de las transferencias: validan la entrada y llaman al motor (`Engine`).

use tauri::{AppHandle, State};

use super::{Conflict, ConflictQuestion, TransferManager};
use crate::error::{AppError, AppResult};
use crate::ssh::SessionStore;
use crate::storage::SettingsStore;
use crate::types::TransferJob;

/// Sube archivos y/o carpetas locales (recursivo) a `remote_dir`. Devuelve `batchId`.
#[tauri::command]
pub async fn transfer_upload(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    transfers: State<'_, TransferManager>,
    _settings: State<'_, SettingsStore>,
    session_id: String,
    local_paths: Vec<String>,
    remote_dir: String,
) -> AppResult<String> {
    if local_paths.is_empty() {
        return Err(AppError::Invalid("No hay nada que subir".into()));
    }
    sessions.get(&session_id).await?;
    Ok(transfers.engine(&app).upload(session_id, local_paths, remote_dir))
}

/// Descarga archivos y/o carpetas remotas (recursivo) a `local_dir`. Devuelve `batchId`.
#[tauri::command]
pub async fn transfer_download(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    transfers: State<'_, TransferManager>,
    _settings: State<'_, SettingsStore>,
    session_id: String,
    remote_paths: Vec<String>,
    local_dir: String,
) -> AppResult<String> {
    if remote_paths.is_empty() {
        return Err(AppError::Invalid("No hay nada que descargar".into()));
    }
    sessions.get(&session_id).await?;
    Ok(transfers.engine(&app).download(session_id, remote_paths, local_dir))
}

/// ¿El lote terminó del todo? (recorrido de carpetas acabado y nada en marcha ni en cola).
/// A diferencia de los eventos de progreso, sabe si el recorrido aún puede añadir trabajos.
#[tauri::command]
pub async fn transfer_batch_finished(transfers: State<'_, TransferManager>, batch_id: String) -> AppResult<bool> {
    Ok(transfers.engine.get().is_none_or(|e| e.batch_finished(&batch_id)))
}

#[tauri::command]
pub async fn transfer_list(transfers: State<'_, TransferManager>) -> AppResult<Vec<TransferJob>> {
    Ok(transfers.engine.get().map(|e| e.list()).unwrap_or_default())
}

/// `ids` puede contener ids de trabajos o de lotes (batchId).
#[tauri::command]
pub async fn transfer_pause(app: AppHandle, transfers: State<'_, TransferManager>, ids: Vec<String>) -> AppResult<()> {
    transfers.engine(&app).pause(&ids);
    Ok(())
}

#[tauri::command]
pub async fn transfer_resume(app: AppHandle, transfers: State<'_, TransferManager>, ids: Vec<String>) -> AppResult<()> {
    transfers.engine(&app).resume(&ids);
    Ok(())
}

#[tauri::command]
pub async fn transfer_cancel(app: AppHandle, transfers: State<'_, TransferManager>, ids: Vec<String>) -> AppResult<()> {
    transfers.engine(&app).cancel(&ids);
    crate::dragout::direct::cancel(&ids);
    Ok(())
}

/// Reintenta trabajos con error (reanuda desde lo ya transferido).
#[tauri::command]
pub async fn transfer_retry(app: AppHandle, transfers: State<'_, TransferManager>, ids: Vec<String>) -> AppResult<()> {
    transfers.engine(&app).retry(&ids);
    Ok(())
}

/// Quita de la lista los trabajos terminados (done / canceled / error).
#[tauri::command]
pub async fn transfer_clear_finished(app: AppHandle, transfers: State<'_, TransferManager>) -> AppResult<()> {
    transfers.engine(&app).clear_finished();
    crate::dragout::direct::clear_finished();
    Ok(())
}

/// Preguntas de conflicto pendientes (para la interfaz al abrirse o recargar).
#[tauri::command]
pub async fn transfer_conflicts(transfers: State<'_, TransferManager>) -> AppResult<Vec<ConflictQuestion>> {
    Ok(transfers.engine.get().map(|e| e.conflicts()).unwrap_or_default())
}

/// Responde una pregunta de conflicto. `answer`: "overwrite" | "skip" | "rename" | "newer".
/// Con `apply_to_all` vale para todos los conflictos de ese lote (pendientes y futuros).
#[tauri::command]
pub async fn transfer_resolve_conflict(
    app: AppHandle,
    transfers: State<'_, TransferManager>,
    job_id: String,
    answer: String,
    apply_to_all: bool,
) -> AppResult<()> {
    let Some(choice) = Conflict::parse_answer(&answer) else {
        return Err(AppError::Invalid(format!("Respuesta no válida: {answer}")));
    };
    transfers.engine(&app).resolve(&job_id, choice, apply_to_all);
    Ok(())
}
