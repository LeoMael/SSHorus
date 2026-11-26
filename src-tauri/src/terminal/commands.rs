//! Comandos Tauri de las terminales SSH: sacan la sesión y llaman a `open`, `tmux` o
//! `TerminalStore`.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use super::{open, tmux, TerminalStore};
use crate::error::AppResult;
use crate::ssh::SessionStore;
use crate::types::{TermOpened, TmuxList, TmuxOpen};

/// Abre una shell interactiva.
/// Con `tmux`, la abre dentro de esa sesión tmux (o se engancha si ya existe); si el servidor no
/// tiene tmux se abre una shell normal y `TermOpened` lo indica.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // firma del comando (la interfaz la llama así)
pub async fn term_open(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    terms: State<'_, TerminalStore>,
    session_id: String,
    cols: u32,
    rows: u32,
    tmux: Option<TmuxOpen>,
    on_data: Channel<InvokeResponseBody>,
) -> AppResult<TermOpened> {
    let session = sessions.get(&session_id).await?;
    open::open(app, &terms, session, session_id, cols, rows, tmux, on_data).await
}

/// Sesiones tmux de SSHorus que siguen vivas en el servidor.
#[tauri::command]
pub async fn term_tmux_list(sessions: State<'_, SessionStore>, session_id: String) -> AppResult<TmuxList> {
    let session = sessions.get(&session_id).await?;
    tmux::list(session).await
}

/// Termina sesiones tmux de SSHorus (cerrar la terminal a propósito o limpiar las que quedaron).
#[tauri::command]
pub async fn term_tmux_kill(
    sessions: State<'_, SessionStore>,
    session_id: String,
    names: Vec<String>,
) -> AppResult<()> {
    let session = sessions.get(&session_id).await?;
    tmux::kill(session, &names).await
}

/// Envía lo que el usuario teclea (texto UTF-8 tal cual lo da xterm.js `onData`).
#[tauri::command]
pub async fn term_write(terms: State<'_, TerminalStore>, term_id: String, data: String) -> AppResult<()> {
    terms.write(&term_id, data.into_bytes())
}

#[tauri::command]
pub async fn term_resize(
    terms: State<'_, TerminalStore>,
    term_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    terms.resize(&term_id, cols, rows)
}

#[tauri::command]
pub async fn term_close(terms: State<'_, TerminalStore>, term_id: String) -> AppResult<()> {
    terms.close(&term_id)
}
