//! Comandos Tauri de SSH: envoltorios finos sobre `open`, `conn_test`, `lifecycle`,
//! `known_hosts` y `reboot_wait`. DUEÑO: agente SSH.

use tauri::{AppHandle, State};

use super::connect::ConnectionTest;
use super::{conn_test, known_hosts, lifecycle, open, reboot_wait, SessionStore};
use crate::error::{AppError, AppResult};
use crate::storage::ProfileStore;
use crate::types::{ServerProfile, SessionInfo};

/// Conecta usando un perfil guardado.
/// - `password` / `passphrase`: si la interfaz los pidió al usuario; si son None se buscan en el llavero.
/// - `save_secret`: si true y la conexión funcionó, guarda el secreto en el llavero.
/// Errores esperados por la interfaz: NeedsPassword, NeedsPassphrase, AuthFailed,
/// HostKeyUnknown (mostrar diálogo y luego `ssh_trust_host` + reintentar), HostKeyChanged, Network.
///
/// Si el secreto venía del llavero y resultó incorrecto, se devuelve NeedsPassword /
/// NeedsPassphrase (no AuthFailed) para que la interfaz lo pida de nuevo.
///
/// 2FA: si el servidor pide un código (keyboard-interactive) y `otp` es None → `NeedsOtp(pregunta)`;
/// la interfaz pide el código y repite la llamada con `otp` (y la misma contraseña).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // firma fija del comando (la interfaz la llama así)
pub async fn ssh_connect(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    profiles: State<'_, ProfileStore>,
    profile_id: String,
    password: Option<String>,
    passphrase: Option<String>,
    // Código 2FA/OTP para keyboard-interactive.
    otp: Option<String>,
    save_secret: Option<bool>,
) -> AppResult<SessionInfo> {
    let profile = profiles.get_server(&profile_id)?;
    open::open_profile(app, &sessions, profile, password, passphrase, otp, save_secret).await
}

/// «Probar conexión» del editor de servidor: conecta y autentica con los datos del formulario
/// (aún sin guardar) y desconecta enseguida. No abre pestaña ni deja la sesión abierta.
/// - `password` / `passphrase`: lo escrito en el formulario. Solo viven en memoria durante la
///   prueba: no se guardan ni se registran.
/// - `use_saved_secret`: si no se escribió nada, usar el secreto ya guardado del servidor
///   (`profile.id`), p. ej. al editar uno existente sin cambiar la contraseña.
/// - Huella desconocida o cambiada: `HostKeyUnknown` / `HostKeyChanged`, como `ssh_connect`
///   (la interfaz pregunta, llama a `ssh_trust_host` y repite la prueba).
/// - Tiempo límite: 10 s. `ssh_cancel_test(test_id)` la cancela (`Canceled`).
#[tauri::command]
pub async fn ssh_test_connection(
    test_id: String,
    profile: ServerProfile,
    password: Option<String>,
    passphrase: Option<String>,
    use_saved_secret: Option<bool>,
) -> AppResult<ConnectionTest> {
    conn_test::test(test_id, profile, password, passphrase, use_saved_secret).await
}

/// Cancela una prueba de conexión en curso (si ya terminó, no hace nada).
#[tauri::command]
pub async fn ssh_cancel_test(test_id: String) -> AppResult<()> {
    conn_test::cancel(&test_id);
    Ok(())
}

/// Guarda la huella aceptada por el usuario en ~/.ssh/known_hosts.
/// Reemplaza cualquier entrada anterior de ese host:puerto (caso "huella cambiada").
#[tauri::command]
pub async fn ssh_trust_host(host: String, port: u16, key_openssh: String) -> AppResult<()> {
    let path = known_hosts::default_path()?;
    let port = if port == 0 { 22 } else { port };
    tokio::task::spawn_blocking(move || known_hosts::trust(&path, &host, port, &key_openssh))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn ssh_disconnect(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    session_id: String,
) -> AppResult<()> {
    lifecycle::close(&app, &sessions, session_id).await;
    Ok(())
}


#[tauri::command]
pub async fn ssh_list_sessions(sessions: State<'_, SessionStore>) -> AppResult<Vec<SessionInfo>> {
    Ok(sessions.list().await)
}

/// La interfaz va a reiniciar el servidor de esa sesión: todas las sesiones abiertas con el mismo
/// servidor (host y puerto) esperarán hasta `wait_secs` a que vuelva. `wait_secs` 0 = ya no
/// (reinicio cancelado). Devuelve cuántas sesiones quedaron avisadas.
#[tauri::command]
pub async fn ssh_expect_reboot(
    sessions: State<'_, SessionStore>,
    session_id: String,
    wait_secs: u32,
) -> AppResult<u32> {
    reboot_wait::expect_for_session(&sessions, &session_id, wait_secs).await
}
