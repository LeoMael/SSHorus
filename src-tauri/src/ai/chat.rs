//! Hablar con el modelo: listar modelos («Probar»), enviar el chat y cancelarlo.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use super::http::{client, endpoint, is_temperature_rejected, send, send_raw, with_auth, SendError};
use super::token::token;
use super::{check_base_url, AiSettings, CHAT_TIMEOUT, MAX_PROMPT, MODELS_TIMEOUT};
use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
struct ModelsResp {
    #[serde(default)]
    data: Vec<ModelItem>,
}

#[derive(Deserialize)]
struct ModelItem {
    id: String,
}

/// «Probar»: `GET <base>/models` con los ajustes guardados. Devuelve los modelos disponibles.
pub async fn list_models(s: AiSettings) -> AppResult<Vec<String>> {
    let s = s.sanitized();
    let base = check_base_url(&s.base_url)?;
    let tok = token().await?;
    let req = client()?.get(endpoint(&base, "models")?).timeout(MODELS_TIMEOUT);
    let body = send(with_auth(req, tok.as_deref())?).await?;
    let r: ModelsResp = serde_json::from_slice(&body).map_err(|_| AppError::Invalid("El servicio no devolvió una lista de modelos".into()))?;
    let mut ids: Vec<String> = r.data.into_iter().map(|m| m.id).collect();
    ids.sort();
    ids.truncate(200);
    Ok(ids)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub(super) struct ChatReq<'a> {
    pub(super) model: &'a str,
    pub(super) messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) temperature: Option<f32>,
}

#[derive(Deserialize)]
struct ChatResp {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMsg,
}

#[derive(Deserialize)]
struct ChoiceMsg {
    #[serde(default)]
    content: Option<String>,
}

fn running() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static R: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAnswer {
    pub model: String,
    pub text: String,
}

async fn post_chat(
    url: &Url,
    tok: Option<&str>,
    model: &str,
    messages: &[ChatMessage],
    temperature: Option<f32>,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, SendError> {
    let body = ChatReq { model, messages, temperature };
    let req = client().map_err(SendError::Other)?.post(url.clone()).timeout(CHAT_TIMEOUT).json(&body);
    let req = with_auth(req, tok).map_err(SendError::Other)?;
    tokio::select! {
        () = cancel.cancelled() => Err(SendError::Other(AppError::Canceled)),
        r = send_raw(req) => r,
    }
}

/// Envía `messages` (lo que el usuario vio y confirmó) a `<base>/chat/completions` con los ajustes
/// guardados. Se cancela con `cancel(request_id)`.
pub async fn chat(s: AiSettings, messages: Vec<ChatMessage>, request_id: String) -> AppResult<ChatAnswer> {
    let s = s.sanitized();
    if !s.enabled {
        return Err(AppError::Invalid("El asistente de IA está desactivado (Ajustes → Asistente de IA)".into()));
    }
    if s.model.is_empty() {
        return Err(AppError::Invalid("Falta el modelo (Ajustes → Asistente de IA)".into()));
    }
    let size: usize = messages.iter().map(|m| m.content.len()).sum();
    if size > MAX_PROMPT || messages.is_empty() {
        return Err(AppError::Invalid("El texto a enviar está vacío o es demasiado largo".into()));
    }
    if messages.iter().any(|m| !matches!(m.role.as_str(), "system" | "user" | "assistant")) {
        return Err(AppError::Invalid("Mensaje no válido".into()));
    }
    let base = check_base_url(&s.base_url)?;
    let url = endpoint(&base, "chat/completions")?;
    let tok = token().await?;
    let cancel = CancellationToken::new();
    if let Ok(mut m) = running().lock() {
        m.insert(request_id.clone(), cancel.clone());
    }
    let first = post_chat(&url, tok.as_deref(), &s.model, &messages, Some(0.2), &cancel).await;
    let result = match first {
        Err(SendError::Http { status, body }) if is_temperature_rejected(status, &body) => {
            post_chat(&url, tok.as_deref(), &s.model, &messages, None, &cancel)
                .await
                .map_err(SendError::into_app_error)
        }
        other => other.map_err(SendError::into_app_error),
    };
    if let Ok(mut m) = running().lock() {
        m.remove(&request_id);
    }
    let bytes = result?;
    let r: ChatResp = serde_json::from_slice(&bytes).map_err(|_| AppError::Invalid("Respuesta de la IA inesperada".into()))?;
    let text = r.choices.into_iter().next().and_then(|c| c.message.content).unwrap_or_default();
    if text.trim().is_empty() {
        return Err(AppError::Invalid("La IA no devolvió texto".into()));
    }
    Ok(ChatAnswer { model: s.model, text })
}

/// Cancela el chat `request_id` en curso. false si ya no estaba.
pub fn cancel(request_id: &str) -> AppResult<bool> {
    let m = running().lock().map_err(|_| AppError::Invalid("registro bloqueado".into()))?;
    Ok(match m.get(request_id) {
        Some(t) => {
            t.cancel();
            true
        }
        None => false,
    })
}
