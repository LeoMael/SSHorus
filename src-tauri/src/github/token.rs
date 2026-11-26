//! El token de GitHub: en la bóveda o el llavero, con una caché en memoria que se olvida al
//! bloquear SSHorus.

use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::storage::secrets;

/// None = aún no se leyó el llavero; Some(None) = no hay token.
static TOKEN: Mutex<Option<Option<String>>> = Mutex::new(None);

fn cache_get() -> Option<Option<String>> {
    TOKEN.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

pub(super) fn cache_set(v: Option<String>) {
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

pub(super) fn check_token_text(t: &str) -> AppResult<()> {
    if t.len() < 20 || t.len() > 512 || !t.chars().all(|c| c.is_ascii_graphic()) {
        return Err(AppError::Invalid(
            "Eso no parece un token de GitHub (empiezan por «ghp_» o «github_pat_»)".into(),
        ));
    }
    Ok(())
}

pub(super) async fn save_token(t: String) -> AppResult<()> {
    let tt = t.clone();
    blocking(move || secrets::set_github_token(&tt)).await?;
    cache_set(Some(t));
    Ok(())
}
