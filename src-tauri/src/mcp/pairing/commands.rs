//! Comandos Tauri del emparejado: peticiones pendientes, tu respuesta y la lista de asistentes.

use std::collections::BTreeMap;

use tauri::State;

use super::super::backend::Backend;
use super::super::policy::Access;
use super::super::McpState;
use super::model::{ClientView, PairDecision, PairPrompt};
use crate::error::AppResult;

fn server_names(state: &McpState) -> BTreeMap<String, String> {
    state.core.backend.profiles().servers.into_iter().map(|s| (s.id, s.name)).collect()
}

#[tauri::command]
pub async fn mcp_pair_pending(state: State<'_, McpState>) -> AppResult<Vec<PairPrompt>> {
    Ok(state.pairing.pending())
}

/// Respuesta del diálogo «Conectar un asistente». false si ya no estaba pendiente.
#[tauri::command]
pub async fn mcp_pair_reply(
    state: State<'_, McpState>,
    id: String,
    accept: bool,
    access: BTreeMap<String, Access>,
) -> AppResult<bool> {
    Ok(state.pairing.reply(&id, PairDecision { accept, access }))
}

#[tauri::command]
pub async fn mcp_paired_clients(state: State<'_, McpState>) -> AppResult<Vec<ClientView>> {
    Ok(state.pairing.clients())
}

/// «Cambiar permisos» de un asistente emparejado.
#[tauri::command]
pub async fn mcp_paired_set_access(
    state: State<'_, McpState>,
    client_id: String,
    access: BTreeMap<String, Access>,
) -> AppResult<Vec<ClientView>> {
    state.pairing.set_access(&client_id, access, &state.core.audit, &server_names(&state))
}

/// «Revocar»: el token de ese asistente deja de valer al instante.
#[tauri::command]
pub async fn mcp_paired_revoke(state: State<'_, McpState>, client_id: String) -> AppResult<Vec<ClientView>> {
    state.pairing.revoke(&client_id, &state.core.audit)
}
