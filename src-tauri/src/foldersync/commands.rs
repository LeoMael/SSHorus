//! Comandos Tauri de «Sincronizar carpeta» (envoltorios finos sobre `Hub` y `saved`).

use tauri::{AppHandle, State};

use super::hub::StartOptions;
use super::model::{SavedSync, SyncInfo, SyncPreview, SyncSpec};
use super::{saved, FolderSyncManager};
use crate::error::{AppError, AppResult};
use crate::ssh::SessionStore;

/// Compara las dos carpetas sin subir nada (vista previa del diálogo).
#[tauri::command]
pub async fn folder_sync_preview(
    app: AppHandle,
    syncs: State<'_, FolderSyncManager>,
    session_id: String,
    spec: SyncSpec,
) -> AppResult<SyncPreview> {
    syncs.hub(&app).preview(&session_id, spec).await
}

/// Une las carpetas y empieza a vigilar. `upload`: subir lo que falta o es más nuevo en el PC;
/// `overwrite_newer`: también lo más nuevo del servidor; `remember`: reactivarla al reconectar.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn folder_sync_start(
    app: AppHandle,
    syncs: State<'_, FolderSyncManager>,
    sessions: State<'_, SessionStore>,
    session_id: String,
    spec: SyncSpec,
    upload: bool,
    overwrite_newer: bool,
    remember: bool,
) -> AppResult<SyncInfo> {
    let server_id = sessions.get(&session_id).await?.info.profile_id.clone();
    let remember = remember && !server_id.is_empty();
    let opts = StartOptions { upload, overwrite_newer, remembered: remember };
    let info = syncs.hub(&app).start(&session_id, spec, opts).await?;
    if remember {
        let spec = info.spec.clone();
        if let Ok(Err(e)) = tauri::async_runtime::spawn_blocking(move || saved::remember(&server_id, &spec)).await {
            log::warn!("no se pudo guardar la sincronización: {e}");
        }
    }
    Ok(info)
}

#[tauri::command]
pub async fn folder_sync_list(app: AppHandle, syncs: State<'_, FolderSyncManager>) -> AppResult<Vec<SyncInfo>> {
    Ok(syncs.hub(&app).list())
}

#[tauri::command]
pub async fn folder_sync_pause(app: AppHandle, syncs: State<'_, FolderSyncManager>, id: String, paused: bool) -> AppResult<()> {
    syncs.hub(&app).set_paused(&id, paused)
}

/// Deja de vigilar. Lo guardado para reconectar se borra aparte (`folder_sync_forget`).
#[tauri::command]
pub async fn folder_sync_remove(app: AppHandle, syncs: State<'_, FolderSyncManager>, id: String) -> AppResult<()> {
    syncs
        .hub(&app)
        .remove(&id)
        .map(|_| ())
        .ok_or_else(|| AppError::NotFound("La sincronización ya no existe".into()))
}

/// Sincronizaciones guardadas de un servidor (para ofrecer reactivarlas al conectar).
#[tauri::command]
pub async fn folder_sync_saved(server_id: String) -> AppResult<Vec<SavedSync>> {
    tauri::async_runtime::spawn_blocking(move || saved::list(&server_id))
        .await
        .map_err(|_| AppError::Io("No se pudieron leer las sincronizaciones guardadas".into()))?
}

#[tauri::command]
pub async fn folder_sync_forget(server_id: String, spec: SyncSpec) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || saved::forget(&server_id, &spec))
        .await
        .map_err(|_| AppError::Io("No se pudo olvidar la sincronización".into()))?
}
