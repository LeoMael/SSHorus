//! Sincronización cifrada por gist privado y compartir/importar colecciones de comandos.

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

use super::api::{self, GhGistInfo};
use super::token::{blocking, token};
use super::{config, crypto};

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
pub async fn find() -> AppResult<Vec<GhGistInfo>> {
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
pub async fn push(
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
pub async fn pull(passphrase: String, gist_id: Option<String>) -> AppResult<SyncPulled> {
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
