//! Cuenta de GitHub dentro de SSHorus.
//! Los comandos de sincronización cifrada y colecciones compartidas viven en `sync_cmds.rs`.

pub mod api;
mod api_gists;
pub mod config;
pub mod crypto;
pub mod device;
pub mod http;
pub mod share;
pub mod sync_cmds;
#[cfg(test)]
mod tests;

pub use sync_cmds::*;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::localkeys::{self, LocalPublicKey};
use crate::storage::secrets;
use api::{GhAccount, GhDeployKey, GhRepo, GhRun, GhSshKey, GhWorkflow};
use config::{DeployRecipe, GhConfig};

// ───────── Token (llavero + caché en memoria) ─────────

/// None = aún no se leyó el llavero; Some(None) = no hay token.
static TOKEN: Mutex<Option<Option<String>>> = Mutex::new(None);

fn cache_get() -> Option<Option<String>> {
    TOKEN.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn cache_set(v: Option<String>) {
    if secrets::ensure_unlocked().is_err() {
        return;
    }
    *TOKEN.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
}

/// Olvida el token guardado en memoria (al bloquear SSHorus o cambiar la bóveda).
pub fn forget_token_cache() {
    *TOKEN.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

pub(super) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interrumpida: {e}")))?
}

pub(super) async fn stored_token() -> AppResult<Option<String>> {
    secrets::ensure_unlocked()?;
    if let Some(t) = cache_get() {
        return Ok(t);
    }
    let t = blocking(secrets::get_github_token).await?;
    cache_set(t.clone());
    Ok(t)
}

pub(super) async fn token() -> AppResult<String> {
    stored_token()
        .await?
        .ok_or_else(|| AppError::AuthFailed("no hay ninguna cuenta de GitHub conectada".into()))
}

fn check_token_text(t: &str) -> AppResult<()> {
    if t.len() < 20 || t.len() > 512 || !t.chars().all(|c| c.is_ascii_graphic()) {
        return Err(AppError::Invalid(
            "Eso no parece un token de GitHub (empiezan por «ghp_» o «github_pat_»)".into(),
        ));
    }
    Ok(())
}

async fn save_token(t: String) -> AppResult<()> {
    let tt = t.clone();
    blocking(move || secrets::set_github_token(&tt)).await?;
    cache_set(Some(t));
    Ok(())
}

// ───────── Cuenta ─────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub connected: bool,
    pub device_flow: bool,
}

#[tauri::command]
pub async fn gh_status() -> AppResult<GhStatus> {
    Ok(GhStatus {
        connected: stored_token().await?.is_some(),
        device_flow: device::available(),
    })
}

/// Comprueba el token contra GitHub y, si vale, lo guarda en el llavero.
#[tauri::command]
pub async fn gh_connect(token: String) -> AppResult<GhAccount> {
    let t = token.trim().to_string();
    check_token_text(&t)?;
    let acc = api::account(&t).await?;
    save_token(t).await?;
    Ok(acc)
}

/// Borra el token del llavero.
#[tauri::command]
pub async fn gh_disconnect() -> AppResult<()> {
    blocking(secrets::delete_github_token).await?;
    cache_set(None);
    Ok(())
}

#[tauri::command]
pub async fn gh_account() -> AppResult<GhAccount> {
    api::account(&token().await?).await
}

#[tauri::command]
pub async fn gh_device_start() -> AppResult<device::DeviceCode> {
    device::start().await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePoll {
    pub status: &'static str,
    pub account: Option<GhAccount>,
}

#[tauri::command]
pub async fn gh_device_poll(device_code: String) -> AppResult<DevicePoll> {
    let status = match device::poll(&device_code).await? {
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

// ───────── Llaves ─────────

#[tauri::command]
pub async fn gh_my_keys() -> AppResult<Vec<GhSshKey>> {
    api::my_keys(&token().await?).await
}

/// Llaves públicas de cualquier usuario de GitHub (no necesita cuenta conectada).
#[tauri::command]
pub async fn gh_user_keys(login: String) -> AppResult<Vec<GhSshKey>> {
    let t = stored_token().await.ok().flatten();
    api::user_keys(t.as_deref(), login.trim()).await
}

/// Sube una llave pública a tu cuenta de GitHub.
#[tauri::command]
pub async fn gh_add_key(title: String, key: String) -> AppResult<GhSshKey> {
    let (line, _, _) = localkeys::parse_public_key_line(&key)?;
    let title = title.trim();
    let title = if title.is_empty() { "SSHorus" } else { title };
    api::add_key(&token().await?, title, &line).await
}

/// Llaves públicas válidas de `~/.ssh/*.pub` (las mismas que `local_ssh_public_keys`; sin carpeta
/// personal, lista vacía).
#[tauri::command]
pub async fn gh_local_pubkeys() -> AppResult<Vec<LocalPublicKey>> {
    blocking(|| {
        Ok(localkeys::ssh_dir()
            .map(|d| localkeys::list_public_keys(&d))
            .unwrap_or_default())
    })
    .await
}

/// Lee UNA llave pública elegida por el usuario (solo archivos `.pub`).
#[tauri::command]
pub async fn gh_read_pubkey(path: String) -> AppResult<LocalPublicKey> {
    blocking(move || localkeys::read_pub(&PathBuf::from(path))).await
}

// ───────── Repositorios ─────────

#[tauri::command]
pub async fn gh_repos() -> AppResult<Vec<GhRepo>> {
    api::repos(&token().await?).await
}

#[tauri::command]
pub async fn gh_branches(owner: String, repo: String) -> AppResult<Vec<String>> {
    api::branches(&token().await?, &owner, &repo).await
}

/// Registra una llave de despliegue de SOLO LECTURA en el repo.
#[tauri::command]
pub async fn gh_add_deploy_key(
    owner: String,
    repo: String,
    title: String,
    key: String,
) -> AppResult<GhDeployKey> {
    let (line, _, _) = localkeys::parse_public_key_line(&key)?;
    let title = title.trim();
    let title = if title.is_empty() { "SSHorus" } else { title };
    api::add_deploy_key(&token().await?, &owner, &repo, title, &line, true).await
}

// ───────── Actions ─────────

#[tauri::command]
pub async fn gh_workflows(owner: String, repo: String) -> AppResult<Vec<GhWorkflow>> {
    api::workflows(&token().await?, &owner, &repo).await
}

#[tauri::command]
pub async fn gh_runs(owner: String, repo: String, limit: u32) -> AppResult<Vec<GhRun>> {
    api::runs(&token().await?, &owner, &repo, limit).await
}

/// Lanza un workflow que tenga `on: workflow_dispatch`.
#[tauri::command]
pub async fn gh_dispatch(
    owner: String,
    repo: String,
    workflow_id: u64,
    git_ref: String,
    inputs: Option<serde_json::Map<String, Value>>,
) -> AppResult<()> {
    let inputs = inputs.unwrap_or_default();
    api::dispatch(
        &token().await?,
        &owner,
        &repo,
        workflow_id,
        git_ref.trim(),
        &inputs,
    )
    .await
}

// ───────── Recetas de despliegue (github.json) ─────────

#[tauri::command]
pub async fn gh_config_load() -> AppResult<GhConfig> {
    blocking(|| Ok(config::load())).await
}

#[tauri::command]
pub async fn gh_recipe_save(recipe: DeployRecipe) -> AppResult<DeployRecipe> {
    blocking(move || config::save_recipe(recipe)).await
}

#[tauri::command]
pub async fn gh_recipe_delete(id: String) -> AppResult<()> {
    blocking(move || config::delete_recipe(&id)).await
}

/// Anota el resultado de la última ejecución de una receta.
#[tauri::command]
pub async fn gh_recipe_mark(id: String, ok: bool) -> AppResult<()> {
    blocking(move || {
        config::update(|cfg| {
            if let Some(r) = cfg.recipes.iter_mut().find(|r| r.id == id) {
                r.last_ok = Some(ok);
                r.last_run_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs());
            }
            Ok(())
        })
    })
    .await
}
