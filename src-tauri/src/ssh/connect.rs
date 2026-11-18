//! Conectar + autenticar. Independiente de la interfaz y del almacenamiento
//! para poder probarlo directamente contra un servidor de pruebas.
//! DUEÑO: agente SSH.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};

use crate::error::{AppError, AppResult};
use crate::ssh::handler::{ClientHandler, HostKeyPolicy, SharedState};
use crate::ssh::{known_hosts, SshSession};
use crate::types::{AuthMethod, ServerProfile, SessionInfo};

mod agent;
mod auth;
mod key;
mod keyboard;
mod net;
mod probe;
#[cfg(test)]
pub mod testutil;

use auth::{authenticate, AuthCtx};
use key::load_key;
use net::{handshake_error, tcp_connect};
pub use probe::{test_connection, ConnectionTest, TEST_TIMEOUT};
// Para `connect_tests` (usa `super::*`).
#[cfg(test)]
use {
    key::expand_tilde,
    keyboard::{classify_prompt, prompt_text, PromptKind},
    probe::AuthSkipped,
};

/// Secretos disponibles para autenticar (ya resueltos desde el llavero o la interfaz).
#[derive(Default, Clone)]
pub struct Credentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
    /// Código 2FA/OTP para keyboard-interactive (de un solo uso: no se reutiliza al reconectar).
    pub otp: Option<String>,
}

/// Tiempo máximo para resolver DNS + abrir TCP.
const TCP_TIMEOUT: Duration = Duration::from_secs(15);
/// Tiempo máximo para la negociación SSH (banner, kex, huella).
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
/// Tiempo máximo para toda la autenticación.
const AUTH_TIMEOUT: Duration = Duration::from_secs(60);

// Mensajes exactos de `AuthFailed`: `ssh_connect` los usa para distinguirlos de otros rechazos.

/// Mensaje (exacto) de `AuthFailed` cuando el servidor rechaza la contraseña.
pub const WRONG_PASSWORD_MSG: &str = "usuario o contraseña incorrectos";
/// Mensaje (exacto) de `AuthFailed` cuando la frase de la llave es incorrecta.
pub const WRONG_PASSPHRASE_MSG: &str = "la frase de la llave privada es incorrecta";
/// Mensaje (exacto) de `AuthFailed` cuando el servidor rechaza el código 2FA/OTP.
pub const WRONG_OTP_MSG: &str = "el código de verificación es incorrecto o caducó";

/// Intervalo de la señal de vida por defecto (s). Caída detectada tras `KEEPALIVE_MAX` sin respuesta.
pub const DEFAULT_KEEPALIVE_SECS: u16 = 10;
/// Señales de vida sin respuesta antes de dar la conexión por perdida.
const KEEPALIVE_MAX: usize = 3;

/// Intervalo de la señal de vida a partir del ajuste `keepaliveSecs` (acotado a 5..=120 s).
pub fn keepalive_interval(secs: u16) -> Duration {
    Duration::from_secs(u64::from(secs.clamp(5, 120)))
}

/// Abre la conexión TCP, verifica la huella contra `~/.ssh/known_hosts` y autentica.
/// (`ssh_connect` usa `connect_policy` para quedarse además con el motivo de cierre.)
#[allow(dead_code)]
pub async fn connect(profile: &ServerProfile, creds: Credentials) -> AppResult<SshSession> {
    let path = known_hosts::default_path()?;
    connect_with(profile, creds, &path).await
}

/// Igual que `connect` pero con un known_hosts concreto (tests).
#[allow(dead_code)]
pub async fn connect_with(
    profile: &ServerProfile,
    creds: Credentials,
    known_hosts_path: &Path,
) -> AppResult<SshSession> {
    connect_policy(
        profile,
        creds,
        HostKeyPolicy::KnownHosts(known_hosts_path.to_path_buf()),
    )
    .await
    .map(|(s, _)| s)
}

fn client_config(keepalive: Duration) -> client::Config {
    client::Config {
        keepalive_interval: Some(keepalive),
        keepalive_max: KEEPALIVE_MAX,
        inactivity_timeout: None,
        nodelay: true,
        ..Default::default()
    }
}

/// Conecta y devuelve también el estado compartido del manejador
/// (para conocer luego el motivo de desconexión). Señal de vida por defecto.
pub(crate) async fn connect_policy(
    profile: &ServerProfile,
    creds: Credentials,
    policy: HostKeyPolicy,
) -> AppResult<(SshSession, Arc<Mutex<SharedState>>)> {
    connect_full(
        profile,
        creds,
        policy,
        keepalive_interval(DEFAULT_KEEPALIVE_SECS),
    )
    .await
}

/// Conexión completa con un intervalo de señal de vida concreto.
pub(crate) async fn connect_full(
    profile: &ServerProfile,
    creds: Credentials,
    policy: HostKeyPolicy,
    keepalive: Duration,
) -> AppResult<(SshSession, Arc<Mutex<SharedState>>)> {
    let (host, port) = target(profile)?;

    // Preparar la llave antes de abrir la red: errores de archivo/frase llegan antes.
    let key = match profile.auth {
        AuthMethod::Key => Some(load_key(profile, creds.passphrase.as_deref()).await?),
        AuthMethod::Password if creds.password.is_none() => return Err(AppError::NeedsPassword),
        _ => None,
    };

    let (mut handle, shared) = open_transport(&host, port, policy, keepalive).await?;

    let user = profile.username.trim().to_string();
    let mut ctx = AuthCtx {
        user: &user,
        password: creds.password.as_deref().filter(|p| !p.is_empty()),
        otp: creds.otp.as_deref().map(str::trim).filter(|p| !p.is_empty()),
        key: key.map(Arc::new),
        used_password: false,
        used_key: false,
        ki_rounds: 0,
    };
    let auth = authenticate(&mut handle, profile.auth, &mut ctx);
    let res = match tokio::time::timeout(AUTH_TIMEOUT, auth).await {
        Ok(r) => r,
        Err(_) => Err(AppError::Network(
            "El servidor tardó demasiado en responder a la autenticación".into(),
        )),
    };
    if let Err(e) = res {
        let _ = handle
            .disconnect(russh::Disconnect::ByApplication, "", "es")
            .await;
        return Err(e);
    }

    let info = SessionInfo {
        id: uuid::Uuid::new_v4().to_string(),
        profile_id: profile.id.clone(),
        name: if profile.name.trim().is_empty() {
            format!("{user}@{host}")
        } else {
            profile.name.clone()
        },
        host,
        port,
        username: user,
        connected_at: now_ms(),
    };
    Ok((SshSession { info, handle }, shared))
}

/// Host (sin espacios) y puerto (0 → 22) del perfil; error si falta el host o el usuario.
fn target(profile: &ServerProfile) -> AppResult<(String, u16)> {
    let host = profile.host.trim().to_string();
    if host.is_empty() {
        return Err(AppError::Invalid("El servidor no tiene host configurado".into()));
    }
    if profile.username.trim().is_empty() {
        return Err(AppError::Invalid("El servidor no tiene usuario configurado".into()));
    }
    let port = if profile.port == 0 { 22 } else { profile.port };
    Ok((host, port))
}

/// Abre TCP y hace la negociación SSH (incluida la verificación de la huella), sin autenticar.
async fn open_transport(
    host: &str,
    port: u16,
    policy: HostKeyPolicy,
    keepalive: Duration,
) -> AppResult<(Handle<ClientHandler>, Arc<Mutex<SharedState>>)> {
    let stream = tcp_connect(host, port).await?;
    let handler = ClientHandler::new(host, port, policy);
    let shared = handler.shared.clone();
    let config = Arc::new(client_config(keepalive));
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, client::connect_stream(config, stream, handler)).await {
        Err(_) => Err(AppError::Network(format!(
            "{host}:{port} no completó la negociación SSH a tiempo"
        ))),
        Ok(Err(e)) => Err(handshake_error(&shared, host, port, e)),
        Ok(Ok(h)) => Ok((h, shared)),
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "connect_tests.rs"]
mod tests;
