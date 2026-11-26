//! Comandos Tauri de la bóveda y del bloqueo: envoltorios finos sobre `storage::lock`.

use tauri::{AppHandle, State};

use super::super::lock::{self, LockState};
use super::super::secrets::MoveReport;
use super::super::vault::{PinKind, VaultStatus};
use super::super::ProfileStore;
use crate::error::AppResult;

#[tauri::command]
pub async fn vault_status() -> AppResult<VaultStatus> {
    Ok(lock::status())
}

/// El usuario hizo algo (tecla, ratón) en alguna ventana: reinicia la cuenta de inactividad.
#[tauri::command]
pub async fn vault_activity(state: State<'_, LockState>) -> AppResult<()> {
    state.touch();
    Ok(())
}

#[tauri::command]
pub async fn vault_unlock(app: AppHandle, pin: String) -> AppResult<VaultStatus> {
    lock::unlock(&app, pin).await
}

#[tauri::command]
pub async fn vault_lock(app: AppHandle) -> AppResult<()> {
    lock::lock_now(&app, "a mano");
    Ok(())
}

/// Crea la bóveda con ese PIN (6 números) o contraseña (8 caracteres o más), según `kind` (por
/// defecto PIN), y mueve a ella los secretos del llavero: contraseñas de conexión y de sudo de
/// cada servidor, y el token de GitHub.
#[tauri::command]
pub async fn vault_enable(
    app: AppHandle,
    profiles: State<'_, ProfileStore>,
    pin: String,
    kind: Option<PinKind>,
) -> AppResult<MoveReport> {
    let ids: Vec<String> = profiles.data().servers.into_iter().map(|s| s.id).collect();
    lock::enable(&app, ids, pin, kind).await
}

/// Quita la bóveda: pide el PIN (o la contraseña) y devuelve los secretos al llavero del sistema.
#[tauri::command]
pub async fn vault_disable(app: AppHandle, pin: String) -> AppResult<MoveReport> {
    lock::disable(&app, pin).await
}

/// Cambia el PIN o la contraseña, o pasa de uno a otro (`new_kind`, por defecto PIN): vuelve a
/// cifrar la bóveda con sal y llave nuevas. Avisa a las ventanas (cambia qué se pide al bloquear).
#[tauri::command]
pub async fn vault_change_pin(
    app: AppHandle,
    old_pin: String,
    new_pin: String,
    new_kind: Option<PinKind>,
) -> AppResult<()> {
    lock::change_pin(&app, old_pin, new_pin, new_kind).await
}

/// «Olvidé mi PIN»: borra la bóveda (se pierden las contraseñas guardadas y los tokens de GitHub,
/// del servidor MCP —se crea uno nuevo— y de la IA que explica informes)
/// y deja SSHorus sin bloqueo. Servidores, ajustes y llaves de ~/.ssh no se tocan.
#[tauri::command]
pub async fn vault_reset(app: AppHandle) -> AppResult<()> {
    lock::reset(&app).await
}
