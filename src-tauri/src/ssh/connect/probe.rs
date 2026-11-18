//! «Probar conexión»: comprueba red, huella y autenticación sin dejar la sesión abierta.

use std::time::Duration;

use russh::client::Handle;
use serde::Serialize;

use super::{connect_full, keepalive_interval, open_transport, target, Credentials, DEFAULT_KEEPALIVE_SECS};
use crate::error::{AppError, AppResult};
use crate::ssh::handler::{ClientHandler, HostKeyPolicy};
use crate::types::ServerProfile;

/// Tiempo máximo de «Probar conexión» (red + huella + autenticación).
pub const TEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Parte de la autenticación que «Probar conexión» no pudo comprobar.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthSkipped {
    /// No se escribió la contraseña (se pedirá al conectar).
    Password,
    /// La llave tiene frase y no se escribió.
    Passphrase,
    /// El servidor pide además un código de verificación (2FA).
    Otp,
}

/// Resultado correcto de «Probar conexión».
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    /// None = se comprobó todo (red, huella y autenticación).
    pub skipped: Option<AuthSkipped>,
    /// Duración de la prueba (ms).
    pub elapsed_ms: u64,
}

/// Cierra una conexión de prueba sin esperar más de 2 s.
async fn close_quietly(handle: &Handle<ClientHandler>) {
    let fut = handle.disconnect(russh::Disconnect::ByApplication, "Prueba de conexión", "es");
    let _ = tokio::time::timeout(Duration::from_secs(2), fut).await;
}

/// Comprueba que se puede entrar con estos datos (aún sin guardar) y desconecta enseguida.
/// La huella se verifica igual que al conectar (`HostKeyUnknown` / `HostKeyChanged`).
/// Si falta la contraseña o la frase, solo comprueba la red y la huella (`skipped`).
/// Termina con `Network` si pasa `limit` y con `Canceled` si se cancela `cancel`.
pub async fn test_connection(
    profile: &ServerProfile,
    creds: Credentials,
    policy: HostKeyPolicy,
    limit: Duration,
    cancel: &tokio_util::sync::CancellationToken,
) -> AppResult<ConnectionTest> {
    let (host, port) = target(profile)?;
    let start = std::time::Instant::now();
    let keepalive = keepalive_interval(DEFAULT_KEEPALIVE_SECS);
    let work = async {
        let skipped = match connect_full(profile, creds, policy.clone(), keepalive).await {
            Ok((session, _)) => {
                close_quietly(&session.handle).await;
                return Ok(None);
            }
            Err(AppError::NeedsOtp(_)) => return Ok(Some(AuthSkipped::Otp)),
            // Sin el secreto no se puede autenticar: se comprueba al menos la red y la huella.
            Err(AppError::NeedsPassword) => AuthSkipped::Password,
            Err(AppError::NeedsPassphrase) => AuthSkipped::Passphrase,
            Err(e) => return Err(e),
        };
        let (handle, _) = open_transport(&host, port, policy, keepalive).await?;
        close_quietly(&handle).await;
        Ok(Some(skipped))
    };
    let skipped = tokio::select! {
        _ = cancel.cancelled() => return Err(AppError::Canceled),
        r = tokio::time::timeout(limit, work) => match r {
            Ok(r) => r?,
            Err(_) => {
                return Err(AppError::Network(format!(
                    "{host}:{port} no respondió en {} s (puede estar apagado, el puerto cerrado o un cortafuegos en medio)",
                    limit.as_secs().max(1)
                )));
            }
        },
    };
    Ok(ConnectionTest {
        skipped,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}
