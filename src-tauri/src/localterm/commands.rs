//! Comandos Tauri de la terminal local y de los asistentes: envoltorios finos sobre `open`,
//! `state`, `aliases` y `LocalTermStore`.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use super::claude_vps::{self, ClaudeVpsSent};
use super::state::{self, LocalTermState};
use super::{aliases, open, AiToolInfo, LocalOpen, LocalOpened, LocalTermInfo, LocalTermStore};
use crate::error::{AppError, AppResult};
use crate::ssh::SessionStore;
use crate::storage::ProfileStore;

#[tauri::command]
pub async fn local_term_info() -> AppResult<LocalTermInfo> {
    Ok(open::term_info())
}

/// ¿Qué asistentes están instalados? (Solo busca los programas; no lee su configuración.)
#[tauri::command]
pub async fn local_ai_detect() -> AppResult<Vec<AiToolInfo>> {
    tokio::task::spawn_blocking(open::detect_tools)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))
}

/// Alias de `~/.ssh/config` exportados por SSHorus que de verdad llevan a cada servidor.
#[tauri::command]
pub async fn local_ai_ssh_aliases(store: State<'_, ProfileStore>) -> AppResult<Vec<aliases::ExportedAlias>> {
    let servers = store.data().servers;
    tokio::task::spawn_blocking(move || aliases::load_exported_aliases(&servers))
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}

/// Abre una terminal local: la shell del sistema o, con `launch`, un asistente de IA.
#[tauri::command]
pub async fn local_term_open(
    app: AppHandle,
    terms: State<'_, LocalTermStore>,
    opts: LocalOpen,
    on_data: Channel<InvokeResponseBody>,
) -> AppResult<LocalOpened> {
    open::open(&app, &terms, opts, on_data).await
}

#[tauri::command]
pub async fn local_term_write(terms: State<'_, LocalTermStore>, term_id: String, data: String) -> AppResult<()> {
    terms.write(&term_id, data.into_bytes())
}

#[tauri::command]
pub async fn local_term_resize(terms: State<'_, LocalTermStore>, term_id: String, cols: u16, rows: u16) -> AppResult<()> {
    terms.resize(&term_id, cols, rows)
}

/// Cierra la terminal: termina el programa y todo lo que lanzó.
#[tauri::command]
pub async fn local_term_close(terms: State<'_, LocalTermStore>, term_id: String) -> AppResult<()> {
    terms.close(&term_id)
}

/// Carpeta actual de la shell y si está ocupada con otro programa.
#[tauri::command]
pub async fn local_term_state(terms: State<'_, LocalTermStore>, term_id: String) -> AppResult<LocalTermState> {
    state::current(&terms, &term_id).await
}

/// «Copiar mi sesión»: el motor lee la sesión de Claude Code de este equipo y la deja en el servidor de
/// `session_id` (usuario con el que se entró), por la entrada estándar de un canal exec. La sesión nunca
/// pasa por la interfaz.
#[tauri::command]
pub async fn claude_vps_copy_session(sessions: State<'_, SessionStore>, session_id: String) -> AppResult<ClaudeVpsSent> {
    let session = sessions.get(&session_id).await?;
    claude_vps::copy_session(&session, &claude_vps::local_creds_path()?).await
}

/// «Llave de acceso»: deja en el servidor la llave de `claude setup-token` que pegó el usuario (se
/// comprueba su forma; viaja por la entrada estándar y se borra de memoria al terminar).
#[tauri::command]
pub async fn claude_vps_set_token(sessions: State<'_, SessionStore>, session_id: String, token: String) -> AppResult<ClaudeVpsSent> {
    let token = claude_vps::normalize_token(&zeroize::Zeroizing::new(token))?;
    let session = sessions.get(&session_id).await?;
    claude_vps::set_token(&session, &token).await
}
