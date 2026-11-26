//! Conectar la cuenta (token o código de dispositivo) y gestionar sus llaves SSH y las de despliegue.

use serde::Serialize;

use super::api::{self, GhAccount, GhDeployKey, GhSshKey};
use super::device;
use super::token::{blocking, check_token_text, save_token, stored_token, token};
use crate::error::AppResult;
use crate::localkeys::{self, LocalPublicKey};
use crate::storage::secrets;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub connected: bool,
    pub device_flow: bool,
}

pub async fn status() -> AppResult<GhStatus> {
    Ok(GhStatus {
        connected: stored_token().await?.is_some(),
        device_flow: device::available(),
    })
}

/// Comprueba el token contra GitHub y, si vale, lo guarda en el llavero.
pub async fn connect(token: &str) -> AppResult<GhAccount> {
    let t = token.trim().to_string();
    check_token_text(&t)?;
    let acc = api::account(&t).await?;
    save_token(t).await?;
    Ok(acc)
}

/// Borra el token del llavero.
pub async fn disconnect() -> AppResult<()> {
    blocking(secrets::delete_github_token).await?;
    super::token::cache_set(None);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePoll {
    pub status: &'static str,
    pub account: Option<GhAccount>,
}

/// Pregunta a GitHub si el usuario ya aceptó el código; si sí, guarda el token.
pub async fn device_poll(device_code: &str) -> AppResult<DevicePoll> {
    let status = match device::poll(device_code).await? {
        device::Poll::Pending => "pending",
        device::Poll::SlowDown => "slowDown",
        device::Poll::Expired => "expired",
        device::Poll::Denied => "denied",
        device::Poll::Token(t) => {
            let acc = api::account(&t).await?;
            save_token(t).await?;
            return Ok(DevicePoll {
                status: "done",
                account: Some(acc),
            });
        }
    };
    Ok(DevicePoll {
        status,
        account: None,
    })
}

/// Sube una llave pública a tu cuenta de GitHub.
pub async fn add_key(title: &str, key: &str) -> AppResult<GhSshKey> {
    let (line, _, _) = localkeys::parse_public_key_line(key)?;
    let title = title.trim();
    let title = if title.is_empty() { "SSHorus" } else { title };
    api::add_key(&token().await?, title, &line).await
}

/// Registra una llave de despliegue de SOLO LECTURA en el repo.
pub async fn add_deploy_key(owner: &str, repo: &str, title: &str, key: &str) -> AppResult<GhDeployKey> {
    let (line, _, _) = localkeys::parse_public_key_line(key)?;
    let title = title.trim();
    let title = if title.is_empty() { "SSHorus" } else { title };
    api::add_deploy_key(&token().await?, owner, repo, title, &line, true).await
}

/// Llaves públicas válidas de `~/.ssh/*.pub` (sin carpeta personal, lista vacía).
pub fn local_pubkeys() -> Vec<LocalPublicKey> {
    localkeys::ssh_dir().map(|d| localkeys::list_public_keys(&d)).unwrap_or_default()
}
