//! Comandos Tauri del historial de auditorías: envoltorios finos sobre `store::History`.

use super::model::{AuditMeta, AuditReport};
use super::store::History;
use crate::error::{AppError, AppResult};
use crate::vulnscan::model::AiExplanation;

/// Guarda una auditoría recién hecha (primero en el historial). Devuelve el informe tal y como quedó.
#[tauri::command]
pub async fn audit_save(report: AuditReport) -> AppResult<AuditReport> {
    tokio::task::spawn_blocking(move || {
        let r = report.sanitized()?;
        History::system().save(&r)?;
        Ok(r)
    })
    .await
    .map_err(|e| AppError::Io(format!("no se pudo guardar la auditoría: {e}")))?
}

#[tauri::command]
pub async fn audit_history_list(server_id: String) -> AppResult<Vec<AuditMeta>> {
    History::system().list(&server_id)
}

#[tauri::command]
pub async fn audit_history_get(server_id: String, report_id: String) -> AppResult<AuditReport> {
    History::system().get(&server_id, &report_id)
}

/// Última auditoría del servidor (None si nunca se auditó).
#[tauri::command]
pub async fn audit_latest(server_id: String) -> AppResult<Option<AuditReport>> {
    History::system().latest(&server_id)
}

/// Borra una auditoría (o todo el historial del servidor si `report_id` no viene).
#[tauri::command]
pub async fn audit_history_delete(server_id: String, report_id: Option<String>) -> AppResult<()> {
    History::system().delete(&server_id, report_id.as_deref())
}

/// Guarda la explicación de la IA junto a la auditoría (None la quita).
#[tauri::command]
pub async fn audit_set_ai(server_id: String, report_id: String, ai: Option<AiExplanation>) -> AppResult<AuditReport> {
    History::system().set_ai(&server_id, &report_id, ai)
}
