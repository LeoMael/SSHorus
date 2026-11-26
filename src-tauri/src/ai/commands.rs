//! Comandos Tauri del asistente de IA: envoltorios finos sobre `token` y `chat`.

use tauri::State;

use super::chat::{self, ChatAnswer, ChatMessage};
use super::token::{self, AiStatus};
use crate::error::AppResult;
use crate::storage::SettingsStore;

#[tauri::command]
pub async fn ai_status() -> AppResult<AiStatus> {
    token::status().await
}

/// Guarda el token (None o vacío lo borra). Va a la bóveda si existe; si no, al llavero.
#[tauri::command]
pub async fn ai_set_token(token: Option<String>) -> AppResult<()> {
    token::set_token(token).await
}

/// «Probar»: `GET <base>/models` con los ajustes guardados. Devuelve los modelos disponibles.
#[tauri::command]
pub async fn ai_test(settings: State<'_, SettingsStore>) -> AppResult<Vec<String>> {
    chat::list_models(settings.get().ai).await
}

/// Envía `messages` a la IA con los ajustes guardados. Se cancela con `ai_cancel(request_id)`.
#[tauri::command]
pub async fn ai_chat(settings: State<'_, SettingsStore>, messages: Vec<ChatMessage>, request_id: String) -> AppResult<ChatAnswer> {
    chat::chat(settings.get().ai, messages, request_id).await
}

#[tauri::command]
pub async fn ai_cancel(request_id: String) -> AppResult<bool> {
    chat::cancel(&request_id)
}
