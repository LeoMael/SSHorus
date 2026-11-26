//! Asistente de IA opcional (v0.5.0): un endpoint compatible con OpenAI (`/chat/completions`) que
//! solo EXPLICA un informe ya hecho. Nunca decide qué es vulnerable ni ejecuta nada.
//!
//! - URL base y modelo en `settings.json` (campo `ai`); el token en la bóveda o el llavero con el id
//!   `ai-token` (`storage::secrets`). Con la bóveda bloqueada no hay IA (`AppError::Locked`).
//! - El HTTP sale de aquí (reqwest + rustls), nunca de la interfaz. HTTPS obligatorio salvo a
//!   `localhost`/`127.0.0.1`/`::1` (modelos locales como Ollama). Sin redirecciones.
//! - El token solo se envía a la URL base guardada en Ajustes.

mod chat;
pub mod commands;
mod http;
mod token;

#[cfg(test)]
mod tests;

use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Id del token en la bóveda o el llavero.
pub const AI_TOKEN_USER: &str = "ai-token";
const CHAT_TIMEOUT: Duration = Duration::from_secs(60);
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: usize = 4 * 1024 * 1024;
/// Límite de lo que se envía (el diálogo ya lo recorta a 60 hallazgos).
const MAX_PROMPT: usize = 200 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub enabled: bool,
    /// p. ej. `https://api.openai.com/v1` o `http://localhost:11434/v1`.
    pub base_url: String,
    pub model: String,
}

impl AiSettings {
    pub fn sanitized(mut self) -> Self {
        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();
        self.model = self.model.trim().to_string();
        self
    }
}

/// Comprueba la URL base: http(s), HTTPS salvo en local, sin usuario/contraseña ni consulta.
pub fn check_base_url(base: &str) -> AppResult<Url> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::Invalid("Falta la URL del servicio de IA (Ajustes → Asistente de IA)".into()));
    }
    let url = Url::parse(base).map_err(|_| AppError::Invalid(format!("URL no válida: {base}")))?;
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "::1");
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        "http" => return Err(AppError::Invalid("Usa https:// (http solo se permite para localhost)".into())),
        _ => return Err(AppError::Invalid("La URL debe empezar por https://".into())),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::Invalid("No pongas usuario ni contraseña en la URL: usa el token".into()));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::Invalid("La URL base no debe llevar «?» ni «#»".into()));
    }
    Ok(url)
}
