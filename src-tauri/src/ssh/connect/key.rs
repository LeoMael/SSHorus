//! Llave privada del perfil: ruta (`~`), lectura y frase.

use std::path::{Path, PathBuf};

use super::WRONG_PASSPHRASE_MSG;
use crate::error::{AppError, AppResult};
use crate::types::ServerProfile;

/// Expande `~` / `~/` al home del usuario.
pub fn expand_tilde(p: &str) -> PathBuf {
    let p = p.trim();
    let Some(home) = dirs::home_dir() else {
        return PathBuf::from(p);
    };
    if p == "~" {
        return home;
    }
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None => PathBuf::from(p),
    }
}

pub(super) async fn load_key(
    profile: &ServerProfile,
    passphrase: Option<&str>,
) -> AppResult<russh::keys::PrivateKey> {
    let raw = profile
        .key_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Invalid("No se indicó la ruta de la llave privada".into()))?;
    let path = expand_tilde(raw);
    let passphrase = passphrase.filter(|p| !p.is_empty()).map(str::to_string);
    tokio::task::spawn_blocking(move || load_key_blocking(&path, passphrase.as_deref()))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

fn load_key_blocking(path: &Path, passphrase: Option<&str>) -> AppResult<russh::keys::PrivateKey> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::Invalid(format!(
                "No existe la llave privada {}",
                path.display()
            )));
        }
        Err(e) => {
            return Err(AppError::Invalid(format!(
                "No se pudo leer la llave privada {}: {e}",
                path.display()
            )));
        }
    };
    if text.trim_start().starts_with("ssh-") || text.trim_start().starts_with("ecdsa-") {
        return Err(AppError::Invalid(format!(
            "{} es una llave pública; elige el archivo de la llave privada (sin .pub)",
            path.display()
        )));
    }
    match russh::keys::decode_secret_key(&text, passphrase) {
        Ok(k) => Ok(k),
        Err(russh::keys::Error::KeyIsEncrypted) => Err(AppError::NeedsPassphrase),
        Err(e) => {
            if passphrase.is_some() {
                // ¿Es una llave cifrada? Entonces la frase está mal.
                match russh::keys::decode_secret_key(&text, None) {
                    Err(russh::keys::Error::KeyIsEncrypted) => {
                        return Err(AppError::AuthFailed(WRONG_PASSPHRASE_MSG.into()));
                    }
                    Err(_) if is_encrypted_pem(&text) => {
                        return Err(AppError::AuthFailed(WRONG_PASSPHRASE_MSG.into()));
                    }
                    _ => {}
                }
            } else if is_encrypted_pem(&text) {
                return Err(AppError::NeedsPassphrase);
            }
            Err(AppError::Invalid(format!(
                "No se pudo leer la llave privada {} (formato no soportado o archivo dañado): {e}",
                path.display()
            )))
        }
    }
}

fn is_encrypted_pem(text: &str) -> bool {
    text.contains("-----BEGIN ENCRYPTED PRIVATE KEY-----") || text.contains("Proc-Type: 4,ENCRYPTED")
}
