//! Bloqueo de SSHorus: comandos de la bóveda, bloqueo por inactividad y aviso a las ventanas.
//!
//! El estado vive aquí (en Rust), no en la interfaz: mientras está bloqueado, `secrets::*`
//! devuelve `AppError::Locked` aunque una ventana siga dibujada. Cada cambio se emite como
//! `vault://state` (payload `VaultStatus`) a todas las ventanas, incluidas las de editor aparte.
//!
//! Inactividad: las ventanas avisan con `vault_activity` (como mucho cada pocos segundos) cuando
//! el usuario teclea o mueve el ratón; un vigilante bloquea al pasar `lock_minutes` sin avisos.
//! Se mide con la hora del sistema, así que el tiempo con el equipo suspendido también cuenta.

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use super::secrets::{self, MoveReport, SystemKeyring};
use super::vault::{self, PinKind, Vault, VaultStatus};
use super::{ProfileStore, SettingsStore};
use crate::error::{AppError, AppResult};
use crate::types::EV_VAULT_STATE;

/// Minutos de inactividad permitidos en Ajustes (0 = nunca).
pub const LOCK_MINUTES: [u32; 6] = [0, 5, 10, 15, 30, 60];

/// Cada cuánto mira el vigilante si toca bloquear.
const WATCH_EVERY: Duration = Duration::from_secs(5);

/// Última actividad del usuario en cualquier ventana.
pub struct LockState {
    last_activity: Mutex<SystemTime>,
}

impl Default for LockState {
    fn default() -> Self {
        Self {
            last_activity: Mutex::new(SystemTime::now()),
        }
    }
}

impl LockState {
    fn touch(&self) {
        *self.last_activity.lock().unwrap_or_else(|p| p.into_inner()) = SystemTime::now();
    }

    fn idle(&self) -> Duration {
        let last = *self.last_activity.lock().unwrap_or_else(|p| p.into_inner());
        // Si la hora del sistema fue hacia atrás, cuenta como actividad reciente.
        SystemTime::now().duration_since(last).unwrap_or_default()
    }
}

fn vault() -> &'static Vault {
    Vault::global()
}

/// Avisa a todas las ventanas del estado actual y olvida lo que se guardó aparte en memoria.
fn notify(app: &AppHandle) {
    crate::github::forget_token_cache();
    crate::mcp::on_vault_change(app);
    let _ = app.emit(EV_VAULT_STATE, vault().status());
}

fn touch(app: &AppHandle) {
    if let Some(s) = app.try_state::<LockState>() {
        s.touch();
    }
}

/// Bloquea ya (si estaba desbloqueada) y avisa a las ventanas.
pub fn lock_now(app: &AppHandle, why: &str) {
    if vault().lock() {
        // Las contraseñas de conexión que se recordaban para sudo («La de la conexión») se olvidan.
        crate::ssh::login_secret::forget_all();
        log::info!("SSHorus bloqueado ({why})");
        notify(app);
    }
}

/// Vigilante del bloqueo por inactividad. Se arranca una vez al iniciar.
pub fn start_idle_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            let minutes = app
                .try_state::<SettingsStore>()
                .map(|s| s.get().lock_minutes)
                .unwrap_or(0);
            if minutes == 0 || !vault().is_unlocked() {
                continue;
            }
            let idle = app
                .try_state::<LockState>()
                .map(|s| s.idle())
                .unwrap_or_default();
            if idle >= Duration::from_secs(u64::from(minutes) * 60) {
                lock_now(&app, "inactividad");
            }
        }
    });
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}

// ───────────────────────── Comandos ─────────────────────────

#[tauri::command]
pub async fn vault_status() -> AppResult<VaultStatus> {
    Ok(vault().status())
}

/// El usuario hizo algo (tecla, ratón) en alguna ventana: reinicia la cuenta de inactividad.
#[tauri::command]
pub async fn vault_activity(state: State<'_, LockState>) -> AppResult<()> {
    state.touch();
    Ok(())
}

#[tauri::command]
pub async fn vault_unlock(app: AppHandle, pin: String) -> AppResult<VaultStatus> {
    let pin = Zeroizing::new(pin);
    blocking(move || vault().unlock(&pin)).await?;
    touch(&app);
    notify(&app);
    Ok(vault().status())
}

#[tauri::command]
pub async fn vault_lock(app: AppHandle) -> AppResult<()> {
    lock_now(&app, "a mano");
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
    let pin = Zeroizing::new(pin);
    let kind = kind.unwrap_or_default();
    vault::check_new_secret(&pin, kind)?;
    let ids: Vec<String> = profiles.data().servers.into_iter().map(|s| s.id).collect();
    let report = blocking(move || {
        let params = vault::calibrate();
        log::info!(
            "bóveda: Argon2id con {} MiB y {} pasadas",
            params.m_kib / 1024,
            params.t
        );
        secrets::enable_vault(vault(), &SystemKeyring(secrets::SERVICE), &ids, &pin, kind, params)
    })
    .await?;
    touch(&app);
    notify(&app);
    Ok(report)
}

/// Quita la bóveda: pide el PIN (o la contraseña) y devuelve los secretos al llavero del sistema.
#[tauri::command]
pub async fn vault_disable(app: AppHandle, pin: String) -> AppResult<MoveReport> {
    let pin = Zeroizing::new(pin);
    let report =
        blocking(move || secrets::disable_vault(vault(), &SystemKeyring(secrets::SERVICE), &pin))
            .await?;
    notify(&app);
    Ok(report)
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
    let old_pin = Zeroizing::new(old_pin);
    let new_pin = Zeroizing::new(new_pin);
    let kind = new_kind.unwrap_or_default();
    vault::check_new_secret(&new_pin, kind)?;
    blocking(move || vault().change_pin(&old_pin, &new_pin, kind, vault::calibrate())).await?;
    notify(&app);
    Ok(())
}

/// «Olvidé mi PIN»: borra la bóveda (se pierden las contraseñas guardadas y los tokens de GitHub,
/// del servidor MCP —se crea uno nuevo— y de la IA que explica informes)
/// y deja SSHorus sin bloqueo. Servidores, ajustes y llaves de ~/.ssh no se tocan.
#[tauri::command]
pub async fn vault_reset(app: AppHandle) -> AppResult<()> {
    blocking(move || vault().remove()).await?;
    log::warn!("bóveda borrada con «Olvidé mi PIN»: las contraseñas guardadas se perdieron");
    touch(&app);
    notify(&app);
    Ok(())
}
