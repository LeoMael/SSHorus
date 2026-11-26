//! «Probar conexión» del editor de servidor: conectar con los datos del formulario, autenticar y
//! desconectar enseguida. Las pruebas en curso se pueden cancelar.

use std::collections::HashMap;

use tokio_util::sync::CancellationToken;

use super::connect::{self, ConnectionTest, Credentials};
use super::handler::HostKeyPolicy;
use super::keyring::{keyring_get, non_empty};
use super::known_hosts;
use crate::error::AppResult;
use crate::types::{AuthMethod, ServerProfile};

/// Pruebas de conexión en curso (id de la prueba → token para cancelarla).
static TESTS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, CancellationToken>>> =
    std::sync::LazyLock::new(Default::default);

/// Quita la prueba del registro al terminar (también si la tarea se interrumpe).
struct TestGuard(String);
impl Drop for TestGuard {
    fn drop(&mut self) {
        if let Ok(mut t) = TESTS.lock() {
            t.remove(&self.0);
        }
    }
}

/// Prueba la conexión `test_id` con `profile` (ver el comando `ssh_test_connection`).
pub async fn test(
    test_id: String,
    profile: ServerProfile,
    password: Option<String>,
    passphrase: Option<String>,
    use_saved_secret: Option<bool>,
) -> AppResult<ConnectionTest> {
    let token = CancellationToken::new();
    if let Ok(mut t) = TESTS.lock()
        && let Some(old) = t.insert(test_id.clone(), token.clone())
    {
        old.cancel();
    }
    let _guard = TestGuard(test_id);

    let mut creds = Credentials {
        password: non_empty(password),
        passphrase: non_empty(passphrase),
        otp: None,
    };
    let saved_wanted = use_saved_secret == Some(true) && !profile.id.is_empty();
    match profile.auth {
        AuthMethod::Password if creds.password.is_none() && saved_wanted => {
            creds.password = keyring_get(&profile.id).await?;
        }
        AuthMethod::Key if creds.passphrase.is_none() && saved_wanted => {
            creds.passphrase = keyring_get(&profile.id).await?;
        }
        _ => {}
    }
    // La contraseña solo se usa con el método «Contraseña» (sin segundo factor en la prueba).
    if profile.auth != AuthMethod::Password {
        creds.password = None;
    }

    let policy = HostKeyPolicy::KnownHosts(known_hosts::default_path()?);
    let r = connect::test_connection(&profile, creds, policy, connect::TEST_TIMEOUT, &token).await;
    match &r {
        Ok(t) => log::info!(
            "prueba de conexión a {}@{}:{}: correcta ({} ms)",
            profile.username.trim(),
            profile.host.trim(),
            profile.port,
            t.elapsed_ms
        ),
        Err(e) => log::info!(
            "prueba de conexión a {}@{}:{}: {}",
            profile.username.trim(),
            profile.host.trim(),
            profile.port,
            e.kind()
        ),
    }
    r
}

/// Cancela la prueba `test_id` en curso (si ya terminó, no hace nada).
pub fn cancel(test_id: &str) {
    if let Some(t) = TESTS.lock().ok().and_then(|mut t| t.remove(test_id)) {
        t.cancel();
    }
}
