//! Abrir una sesión SSH con un perfil guardado: elegir el secreto, conectar, registrar la sesión y
//! dejar vigilando la reconexión.

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use super::connect::{self, Credentials, WRONG_PASSPHRASE_MSG, WRONG_PASSWORD_MSG};
use super::handler::HostKeyPolicy;
use super::keyring::{keyring_get, keyring_set, non_empty};
use super::lifecycle::TauriEnv;
use super::reconnect::{self, Supervised, Timing};
use super::{known_hosts, SessionStore};
use crate::error::{AppError, AppResult};
use crate::storage::vault::Vault;
use crate::storage::SettingsStore;
use crate::types::{AuthMethod, ServerProfile, SessionInfo};

/// Conecta con `profile`. Qué hace con `password`, `passphrase`, `otp` y `save_secret`, y qué errores
/// devuelve: ver el comando `ssh_connect`.
pub async fn open_profile(
    app: AppHandle,
    sessions: &SessionStore,
    profile: ServerProfile,
    password: Option<String>,
    passphrase: Option<String>,
    otp: Option<String>,
    save_secret: Option<bool>,
) -> AppResult<SessionInfo> {
    let password = non_empty(password);
    let passphrase = non_empty(passphrase);

    // Secreto relevante según el método: el que dio el usuario o, si no, el del llavero.
    let mut creds = Credentials {
        otp: non_empty(otp),
        ..Default::default()
    };
    let mut user_secret: Option<String> = None;
    let mut from_keyring = false;
    match profile.auth {
        AuthMethod::Password => {
            if let Some(p) = password {
                user_secret = Some(p.clone());
                creds.password = Some(p);
            } else if let Some(p) = keyring_get(&profile.id).await? {
                from_keyring = true;
                creds.password = Some(p);
            }
        }
        AuthMethod::Key => {
            if let Some(p) = passphrase {
                user_secret = Some(p.clone());
                creds.passphrase = Some(p);
            } else if let Some(p) = keyring_get(&profile.id).await? {
                from_keyring = true;
                creds.passphrase = Some(p);
            }
            // Contraseña opcional como segundo factor (llave + contraseña).
            creds.password = password;
        }
        AuthMethod::Agent => creds.password = password,
    }

    let settings = app
        .try_state::<SettingsStore>()
        .map(|s| s.get())
        .unwrap_or_default();
    let keepalive = connect::keepalive_interval(settings.keepalive_secs);
    let policy = HostKeyPolicy::KnownHosts(known_hosts::default_path()?);
    let connected =
        connect::connect_full(&profile, creds.clone(), policy.clone(), keepalive).await;
    let (session, shared) = match connected {
        Ok(v) => v,
        Err(AppError::AuthFailed(msg)) if from_keyring && msg == WRONG_PASSWORD_MSG => {
            log::info!("la contraseña guardada de {} ya no es válida", profile.id);
            return Err(AppError::NeedsPassword);
        }
        Err(AppError::AuthFailed(msg)) if from_keyring && msg == WRONG_PASSPHRASE_MSG => {
            log::info!("la frase guardada de {} ya no es válida", profile.id);
            return Err(AppError::NeedsPassphrase);
        }
        Err(e) => return Err(e),
    };

    let mut saved = false;
    if save_secret == Some(true)
        && let Some(secret) = user_secret
    {
        saved = keyring_set(&profile.id, secret).await;
    }
    // Con la bóveda activa, el secreto guardado no se queda en memoria con la sesión: al
    // reconectar se vuelve a leer (y si SSHorus está bloqueado, se espera al desbloqueo).
    let stored_secret = (from_keyring || saved) && Vault::global().is_enabled();
    // Para sudo «La de la conexión»: la contraseña escrita al conectar (sin guardarla en la bóveda) queda
    // en memoria mientras viva la sesión (ver `login_secret`).
    let login_password = match (&profile.auth, &creds.password) {
        (AuthMethod::Password, Some(p)) if !stored_secret => Some(zeroize::Zeroizing::new(p.clone())),
        _ => None,
    };
    if stored_secret {
        match profile.auth {
            AuthMethod::Password => creds.password = None,
            AuthMethod::Key => creds.passphrase = None,
            AuthMethod::Agent => {}
        }
    }

    let session = Arc::new(session);
    let info = session.info.clone();
    sessions.insert(session.clone()).await;
    if let Some(p) = login_password {
        super::login_secret::remember(&info.id, &p);
    }
    // El código OTP es de un solo uso: no sirve para reconectar.
    creds.otp = None;
    let sup = Supervised {
        profile,
        creds,
        stored_secret,
        policy,
        session,
        shared,
    };
    tauri::async_runtime::spawn(reconnect::supervise(
        Arc::new(TauriEnv { app }),
        sup,
        Timing::default(),
    ));
    log::info!(
        "conectado a {}@{}:{} (sesión {})",
        info.username,
        info.host,
        info.port,
        info.id
    );
    Ok(info)
}
