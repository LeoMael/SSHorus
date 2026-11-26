//! Secretos guardados: contraseña o frase de cada servidor (usuario = id del servidor), su
//! contraseña de sudo (usuario = "<id>:sudo"), los usuarios y contraseñas de sus bases de datos
//! (usuario = "<id>:db", ver `db_secret.rs`) y el token de GitHub (usuario "github-token").
//!
//! Dónde se guardan:
//! - Con la bóveda activa (`storage::vault`): en `vault.json`, cifrados con el PIN o la contraseña. Si está
//!   bloqueada, todas las funciones devuelven `AppError::Locked`.
//! - Sin bóveda: en el llavero del sistema (servicio "sshorus"), como siempre.
//!
//! El llavero usa `keyring` 4 (modo `v1`): el almacén por defecto de la plataforma (Secret
//! Service en Linux, Keychain en macOS, Credential Manager en Windows) se inicializa una sola
//! vez, de forma perezosa, en la primera llamada.
//!
//! Las llamadas pueden bloquear (D-Bus): desde código async conviene usar `spawn_blocking`.
//!
//! Archivos: aquí la API (leer, guardar y borrar; ids de cada secreto) · `system_keyring` (el
//! llavero del sistema y sus errores) · `vault_move` (mover secretos entre el llavero y la bóveda).

mod system_keyring;
mod vault_move;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::vault::Vault;
use crate::error::{AppError, AppResult};

pub(crate) use system_keyring::{Keyring, KeyringDeviceKey, SystemKeyring};
pub use vault_move::MoveReport;
pub(crate) use vault_move::{disable_vault, enable_vault};

/// Servicio usado en el llavero real.
pub const SERVICE: &str = "sshorus";

fn check_user(user: &str) -> AppResult<()> {
    if user.trim().is_empty() {
        return Err(AppError::Invalid("Falta el id del servidor para el llavero".into()));
    }
    Ok(())
}

pub fn get_secret(profile_id: &str) -> AppResult<Option<String>> {
    get_with(Vault::global(), &SystemKeyring(SERVICE), profile_id)
}

pub fn set_secret(profile_id: &str, secret: &str) -> AppResult<()> {
    set_with(Vault::global(), &SystemKeyring(SERVICE), profile_id, secret)
}

/// Borra el secreto. Si no existía, no es error.
pub fn delete_secret(profile_id: &str) -> AppResult<()> {
    delete_with(Vault::global(), &SystemKeyring(SERVICE), profile_id)
}

/// Lee de la bóveda si existe; si no, del llavero.
pub(crate) fn get_with(vault: &Vault, kr: &dyn Keyring, id: &str) -> AppResult<Option<String>> {
    check_user(id)?;
    match vault.get(id) {
        Some(r) => r,
        None => kr.get(id),
    }
}

pub(crate) fn set_with(vault: &Vault, kr: &dyn Keyring, id: &str, secret: &str) -> AppResult<()> {
    check_user(id)?;
    match vault.set(id, secret) {
        Some(r) => r,
        None => kr.set(id, secret),
    }
}

pub(crate) fn delete_with(vault: &Vault, kr: &dyn Keyring, id: &str) -> AppResult<()> {
    check_user(id)?;
    match vault.delete(id) {
        Some(r) => r,
        None => kr.delete(id),
    }
}

// ───────── Secretos de un servidor: contraseña de conexión y contraseña de sudo ─────────

/// Final del id de la contraseña de sudo de un servidor ("<id>:sudo").
pub const SUDO_SUFFIX: &str = ":sudo";

/// Id (en la bóveda o el llavero) de la contraseña de sudo guardada de un servidor.
pub fn sudo_id(profile_id: &str) -> String {
    format!("{profile_id}{SUDO_SUFFIX}")
}

/// Qué secreto de un servidor: el de conexión (contraseña o frase de la llave) o el de sudo.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecretKind {
    #[default]
    Login,
    Sudo,
}

impl SecretKind {
    /// Id donde se guarda ese secreto del servidor.
    pub fn id(self, profile_id: &str) -> String {
        match self {
            SecretKind::Login => profile_id.to_string(),
            SecretKind::Sudo => sudo_id(profile_id),
        }
    }
}

/// Final del id de las credenciales de bases de datos de un servidor ("<id>:db").
pub const DB_SUFFIX: &str = ":db";

/// Id (en la bóveda o el llavero) de las credenciales de bases de datos de un servidor.
pub fn db_id(profile_id: &str) -> String {
    format!("{profile_id}{DB_SUFFIX}")
}

/// Todos los ids de secretos de un servidor.
pub fn server_secret_ids(profile_id: &str) -> [String; 3] {
    [profile_id.to_string(), sudo_id(profile_id), db_id(profile_id)]
}

/// Borra los secretos de un servidor (conexión, sudo y bases de datos). Intenta todos; devuelve el primer error.
pub(crate) fn delete_server_secrets_with(vault: &Vault, kr: &dyn Keyring, profile_id: &str) -> AppResult<()> {
    let mut first = Ok(());
    for id in server_secret_ids(profile_id) {
        let r = delete_with(vault, kr, &id);
        if first.is_ok() {
            first = r;
        }
    }
    first
}

/// Copia los secretos de un servidor (conexión, sudo y bases de datos) a otro (al duplicar).
pub(crate) fn copy_server_secrets_with(vault: &Vault, kr: &dyn Keyring, from: &str, to: &str) -> AppResult<()> {
    for (src, dst) in server_secret_ids(from).iter().zip(server_secret_ids(to).iter()) {
        if let Some(secret) = get_with(vault, kr, src)?.map(Zeroizing::new) {
            set_with(vault, kr, dst, &secret)?;
        }
    }
    Ok(())
}

pub fn delete_server_secrets(profile_id: &str) -> AppResult<()> {
    delete_server_secrets_with(Vault::global(), &SystemKeyring(SERVICE), profile_id)
}

pub fn copy_server_secrets(from: &str, to: &str) -> AppResult<()> {
    copy_server_secrets_with(Vault::global(), &SystemKeyring(SERVICE), from, to)
}

/// Error si la bóveda está bloqueada (para cachés que no pasan por `get_secret`).
pub fn ensure_unlocked() -> AppResult<()> {
    let st = Vault::global().status();
    if st.locked {
        return Err(AppError::Locked);
    }
    Ok(())
}

// ───────── Token de GitHub (usuario "github-token") ─────────

/// Usuario del llavero (o id en la bóveda) donde se guarda el token personal de GitHub.
pub const GITHUB_TOKEN_USER: &str = "github-token";

/// Token de GitHub guardado (None si no hay cuenta conectada).
pub fn get_github_token() -> AppResult<Option<String>> {
    get_secret(GITHUB_TOKEN_USER)
}

/// Guarda (o reemplaza) el token de GitHub. Solo en la bóveda o el llavero: nunca en archivos
/// sin cifrar ni en logs.
pub fn set_github_token(token: &str) -> AppResult<()> {
    set_secret(GITHUB_TOKEN_USER, token)
}

/// Borra el token de GitHub ("Desconectar"). Si no existía, no es error.
pub fn delete_github_token() -> AppResult<()> {
    delete_secret(GITHUB_TOKEN_USER)
}

// ───────── Token del servidor MCP (usuario "mcp-token") ─────────

/// Usuario del llavero (o id en la bóveda) del token que usan los asistentes de IA (módulo `mcp`).
pub const MCP_TOKEN_USER: &str = "mcp-token";
