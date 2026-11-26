//! Comandos Tauri de GitHub: envoltorios finos sobre `account`, `api`, `config`, `sync` y
//! `collections`.

use std::path::PathBuf;

use serde_json::Value;

use super::account::{self, DevicePoll, GhStatus};
use super::api::{self, GhAccount, GhDeployKey, GhGistInfo, GhRepo, GhRun, GhSshKey, GhWorkflow};
use super::config::{self, DeployRecipe, GhConfig};
use super::sync::{self, SyncPulled};
use super::token::{blocking, stored_token, token};
use super::{collections, device};
use crate::error::AppResult;
use crate::localkeys::{self, LocalPublicKey};
use crate::types::Snippet;

// ───────── Cuenta ─────────

#[tauri::command]
pub async fn gh_status() -> AppResult<GhStatus> {
    account::status().await
}

/// Comprueba el token contra GitHub y, si vale, lo guarda en el llavero.
#[tauri::command]
pub async fn gh_connect(token: String) -> AppResult<GhAccount> {
    account::connect(&token).await
}

/// Borra el token del llavero.
#[tauri::command]
pub async fn gh_disconnect() -> AppResult<()> {
    account::disconnect().await
}

#[tauri::command]
pub async fn gh_account() -> AppResult<GhAccount> {
    api::account(&token().await?).await
}

#[tauri::command]
pub async fn gh_device_start() -> AppResult<device::DeviceCode> {
    device::start().await
}

#[tauri::command]
pub async fn gh_device_poll(device_code: String) -> AppResult<DevicePoll> {
    account::device_poll(&device_code).await
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
    account::add_key(&title, &key).await
}

/// Llaves públicas válidas de `~/.ssh/*.pub` (las mismas que `local_ssh_public_keys`; sin carpeta
/// personal, lista vacía).
#[tauri::command]
pub async fn gh_local_pubkeys() -> AppResult<Vec<LocalPublicKey>> {
    blocking(|| Ok(account::local_pubkeys())).await
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
    account::add_deploy_key(&owner, &repo, &title, &key).await
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
    blocking(move || config::mark_recipe(&id, ok)).await
}

// ───────── Copia cifrada y colecciones de comandos ─────────

/// Gists de la cuenta que contienen una copia de SSHorus.
#[tauri::command]
pub async fn gh_sync_find() -> AppResult<Vec<GhGistInfo>> {
    sync::find().await
}

/// Cifra `payload` con la frase y lo sube al gist privado (lo crea si no existe).
#[tauri::command]
pub async fn gh_sync_push(payload: Value, passphrase: String, gist_id: Option<String>) -> AppResult<GhGistInfo> {
    sync::push(payload, passphrase, gist_id).await
}

/// Baja la copia del gist y la descifra (no toca nada local: la interfaz muestra la vista previa).
#[tauri::command]
pub async fn gh_sync_pull(passphrase: String, gist_id: Option<String>) -> AppResult<SyncPulled> {
    sync::pull(passphrase, gist_id).await
}

/// Lee una colección de comandos de un gist o de un archivo de GitHub (vista previa; no guarda).
#[tauri::command]
pub async fn gh_fetch_snippets(source: String) -> AppResult<Vec<Snippet>> {
    collections::fetch(&source).await
}

/// Publica una colección de comandos en un gist nuevo (secreto salvo `public`).
#[tauri::command]
pub async fn gh_share_snippets(snippets: Vec<Snippet>, description: String, public: bool) -> AppResult<GhGistInfo> {
    collections::share(snippets, description, public).await
}
