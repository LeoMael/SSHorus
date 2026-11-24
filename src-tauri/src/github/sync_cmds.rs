//! Sincronización cifrada por gist privado y compartir/importar colecciones de comandos.

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::types::Snippet;

use super::api::{self, GhGistInfo};
use super::{blocking, config, crypto, http, share, stored_token, token};

/// Nombre del archivo cifrado dentro del gist de sincronización.
pub const SYNC_FILE: &str = "sshorus-sync.json";
const SYNC_DESCRIPTION: &str = "SSHorus: configuración cifrada (servidores, proyectos y comandos)";
const MAX_SYNC_PAYLOAD: usize = 4 * 1024 * 1024;

/// Claves que nunca deben viajar en la copia (defensa en profundidad: la interfaz no las manda).
const FORBIDDEN_KEYS: &[&str] = &["password", "passphrase", "secret", "token", "privatekey"];

pub fn find_forbidden(v: &Value) -> Option<String> {
    match v {
        Value::Object(o) => o.iter().find_map(|(k, v)| {
            let lk = k.to_ascii_lowercase().replace(['_', '-'], "");
            if FORBIDDEN_KEYS.contains(&lk.as_str()) {
                Some(k.clone())
            } else {
                find_forbidden(v)
            }
        }),
        Value::Array(a) => a.iter().find_map(find_forbidden),
        _ => None,
    }
}

async fn find_sync_gists(tok: &str) -> AppResult<Vec<GhGistInfo>> {
    let list = api::gists(tok).await?;
    Ok(list
        .into_iter()
        .filter(|g| g.files.contains_key(SYNC_FILE))
        .map(|g| g.info())
        .collect())
}

/// Gists de la cuenta que contienen una copia de SSHorus.
#[tauri::command]
pub async fn gh_sync_find() -> AppResult<Vec<GhGistInfo>> {
    find_sync_gists(&token().await?).await
}

fn remember_gist(g: &GhGistInfo) -> AppResult<()> {
    let id = g.id.clone();
    let at = g.updated_at.clone();
    config::update(move |cfg| {
        cfg.sync_gist_id = Some(id);
        cfg.sync_updated_at = at;
        Ok(())
    })
}

/// Cifra `payload` con la frase y lo sube al gist privado (lo crea si no existe).
#[tauri::command]
pub async fn gh_sync_push(
    payload: Value,
    passphrase: String,
    gist_id: Option<String>,
) -> AppResult<GhGistInfo> {
    if !payload.is_object() {
        return Err(AppError::Invalid(
            "datos de sincronización no válidos".into(),
        ));
    }
    if let Some(k) = find_forbidden(&payload) {
        return Err(AppError::Invalid(format!(
            "la copia no puede incluir secretos (campo «{k}»)"
        )));
    }
    let plain = serde_json::to_vec(&payload)?;
    if plain.len() > MAX_SYNC_PAYLOAD {
        return Err(AppError::Invalid(
            "la configuración es demasiado grande para sincronizarla".into(),
        ));
    }
    let t = token().await?;
    let env = blocking(move || crypto::encrypt(&plain, &passphrase)).await?;
    let content = serde_json::to_string_pretty(&env)?;

    let mut target = gist_id
        .filter(|s| !s.trim().is_empty())
        .or_else(|| config::load().sync_gist_id);
    if target.is_none() {
        target = find_sync_gists(&t).await?.into_iter().next().map(|g| g.id);
    }
    let files = [(SYNC_FILE, content)];
    let saved = match target.as_deref() {
        Some(id) => match api::save_gist(&t, Some(id), SYNC_DESCRIPTION, false, &files).await {
            Err(AppError::NotFound(_)) => {
                api::save_gist(&t, None, SYNC_DESCRIPTION, false, &files).await?
            }
            other => other?,
        },
        None => api::save_gist(&t, None, SYNC_DESCRIPTION, false, &files).await?,
    };
    let info = saved.info();
    let i2 = info.clone();
    blocking(move || remember_gist(&i2)).await?;
    Ok(info)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPulled {
    pub gist: GhGistInfo,
    pub payload: Value,
}

/// Baja la copia del gist y la descifra (no toca nada local: la interfaz muestra la vista previa).
#[tauri::command]
pub async fn gh_sync_pull(passphrase: String, gist_id: Option<String>) -> AppResult<SyncPulled> {
    let t = token().await?;
    let mut id = gist_id
        .filter(|s| !s.trim().is_empty())
        .or_else(|| config::load().sync_gist_id);
    if id.is_none() {
        id = find_sync_gists(&t).await?.into_iter().next().map(|g| g.id);
    }
    let id = id
        .ok_or_else(|| AppError::NotFound("no hay ninguna copia de SSHorus en tus gists".into()))?;
    let g = api::gist(Some(&t), id.trim()).await?;
    let f = g
        .file(SYNC_FILE)
        .ok_or_else(|| AppError::NotFound(format!("el gist no contiene {SYNC_FILE}")))?;
    let text = api::gist_file_content(Some(&t), &f).await?;
    let env: crypto::Envelope = serde_json::from_str(&text)
        .map_err(|_| AppError::Invalid("el gist no contiene una copia de SSHorus válida".into()))?;
    let plain = blocking(move || crypto::decrypt(&env, &passphrase)).await?;
    let payload: Value = serde_json::from_slice(&plain)?;
    let info = g.info();
    let i2 = info.clone();
    blocking(move || remember_gist(&i2)).await?;
    Ok(SyncPulled {
        gist: info,
        payload,
    })
}

/// Lee una colección de comandos de un gist o de un archivo de GitHub (vista previa; no guarda).
#[tauri::command]
pub async fn gh_fetch_snippets(source: String) -> AppResult<Vec<Snippet>> {
    let t = stored_token().await.ok().flatten();
    let text = match share::resolve(&source)? {
        share::Source::Gist(id) => {
            let g = api::gist(t.as_deref(), &id).await?;
            let files = g.all_files();
            let f = files
                .iter()
                .find(|f| {
                    f.filename
                        .as_deref()
                        .is_some_and(|n| n.to_ascii_lowercase().ends_with(".json"))
                })
                .or(files.first())
                .ok_or_else(|| AppError::NotFound("el gist está vacío".into()))?;
            api::gist_file_content(t.as_deref(), f).await?
        }
        share::Source::Raw(url) => {
            let r = http::get_url(t.as_deref(), &url, 2 * 1024 * 1024).await?;
            String::from_utf8(r.body)
                .map_err(|_| AppError::Invalid("el archivo no es texto".into()))?
        }
    };
    share::parse_collection(&text)
}

/// Publica una colección de comandos en un gist nuevo (secreto salvo `public`).
#[tauri::command]
pub async fn gh_share_snippets(
    snippets: Vec<Snippet>,
    description: String,
    public: bool,
) -> AppResult<GhGistInfo> {
    if snippets.is_empty() {
        return Err(AppError::Invalid("elige al menos un comando".into()));
    }
    if snippets.len() > share::MAX_SNIPPETS {
        return Err(AppError::Invalid("demasiados comandos".into()));
    }
    let content = share::to_collection(&snippets)?;
    let desc = description.trim();
    let desc = if desc.is_empty() {
        "Comandos de SSHorus"
    } else {
        desc
    };
    let g = api::save_gist(
        &token().await?,
        None,
        desc,
        public,
        &[("sshorus-comandos.json", content)],
    )
    .await?;
    Ok(g.info())
}
