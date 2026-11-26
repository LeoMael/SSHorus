//! Comandos Tauri de los túneles: envoltorios finos sobre `TunnelManager` y `local_ports`.

use tauri::{AppHandle, State};

use super::local_ports;
use super::manager::{Sessions, TunnelManager};
use super::types::{TunnelDef, TunnelStatus};
use crate::error::AppResult;

/// Túneles guardados de un servidor.
#[tauri::command]
pub async fn tunnels_list(
    manager: State<'_, TunnelManager>,
    profile_id: String,
) -> AppResult<Vec<TunnelDef>> {
    Ok(manager.defs.list(&profile_id))
}

/// Crea (id "") o actualiza un túnel. Si estaba activo y cambió su conexión, se reinicia.
#[tauri::command]
pub async fn tunnels_save(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    tunnel: TunnelDef,
) -> AppResult<TunnelDef> {
    let saved = manager.defs.save(tunnel)?;
    manager.restart_changed(&Sessions::App(app), &saved).await;
    Ok(saved)
}

/// Borra un túnel guardado (y lo para donde esté activo).
#[tauri::command]
pub async fn tunnels_delete(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    id: String,
) -> AppResult<()> {
    manager.stop_everywhere(&Sessions::App(app), &id).await;
    manager.defs.delete(&id)
}

/// Activa un túnel en una sesión conectada. Errores claros (puerto ocupado, servidor que no permite…).
#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    session_id: String,
    tunnel_id: String,
) -> AppResult<TunnelStatus> {
    manager
        .start(&Sessions::App(app), &session_id, &tunnel_id)
        .await
}

#[tauri::command]
pub async fn tunnel_stop(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    session_id: String,
    tunnel_id: String,
) -> AppResult<()> {
    manager
        .stop(&Sessions::App(app), &session_id, &tunnel_id)
        .await;
    Ok(())
}

/// Estado de los túneles en marcha (o con error) de una sesión.
#[tauri::command]
pub async fn tunnels_status(
    manager: State<'_, TunnelManager>,
    session_id: String,
) -> AppResult<Vec<TunnelStatus>> {
    Ok(manager.statuses(&session_id))
}

/// Puertos que proponer en tu PC al traer servicios del servidor: el mismo si está libre o el siguiente
/// libre (0 = que elija el sistema). `avoid`: puertos de otros túneles guardados.
#[tauri::command]
pub async fn tunnels_suggest_local_ports(wanted: Vec<u16>, avoid: Vec<u16>) -> AppResult<Vec<u16>> {
    Ok(local_ports::suggest(&wanted, &avoid, local_ports::is_free))
}
