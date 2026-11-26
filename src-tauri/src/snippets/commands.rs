//! Comandos Tauri de la biblioteca de comandos y de la ejecución aparte: envoltorios finos sobre
//! `SnippetStore`, `run` y `ExecRegistry`.

use tauri::{AppHandle, Emitter, State};

use super::run::{self, SudoExecResult, EV_EXEC_OUTPUT};
use super::{ExecRegistry, SnippetStore};
use crate::error::AppResult;
use crate::ssh::SessionStore;
use crate::types::{ExecResult, Snippet};

#[tauri::command]
pub async fn snippets_load(store: State<'_, SnippetStore>) -> AppResult<Vec<Snippet>> {
    Ok(store.list())
}

/// Crea o actualiza (id "" = nuevo; se asigna UUID). Devuelve el guardado.
#[tauri::command]
pub async fn snippets_save(store: State<'_, SnippetStore>, snippet: Snippet) -> AppResult<Snippet> {
    store.save(snippet)
}

#[tauri::command]
pub async fn snippets_delete(store: State<'_, SnippetStore>, id: String) -> AppResult<()> {
    store.delete(&id)
}

/// Ejecuta `command` en un canal exec aparte (sin PTY) y captura stdout/stderr/código.
/// Límite de tiempo `timeout_secs` (1..=600) y de salida (2 MB por flujo → `truncated`).
/// Al vencer el tiempo se detiene también el proceso remoto.
/// `exec_id` (opcional, lo elige la interfaz) permite cancelarlo con `exec_cancel`; entonces
/// devuelve el error `Canceled`.
#[tauri::command]
pub async fn exec_capture(
    sessions: State<'_, SessionStore>,
    registry: State<'_, ExecRegistry>,
    session_id: String,
    command: String,
    timeout_secs: u32,
    exec_id: Option<String>,
) -> AppResult<ExecResult> {
    run::run_registered(&sessions, &registry, &session_id, &command, None, timeout_secs, exec_id.as_deref()).await
}

/// Como `exec_capture`, pero escribe `stdin` en la entrada estándar del comando y luego envía EOF.
/// Pensado para pasar contraseñas (sudo -S, chpasswd) sin que aparezcan en la línea de comandos.
/// El contenido de `stdin` nunca se registra ni aparece en errores; se borra de memoria al terminar.
#[tauri::command]
pub async fn exec_capture_stdin(
    sessions: State<'_, SessionStore>,
    registry: State<'_, ExecRegistry>,
    session_id: String,
    command: String,
    stdin: String,
    timeout_secs: u32,
    exec_id: Option<String>,
) -> AppResult<ExecResult> {
    run::run_with_secret_stdin(&sessions, &registry, &session_id, &command, stdin, timeout_secs, exec_id.as_deref()).await
}

/// Como `exec_capture_stdin` (siempre cancelable), pero además envía la salida según llega con el evento
/// `exec://output` (`{ execId, stderr, text }`). Para ejecuciones largas que el usuario mira en pantalla
/// (p. ej. actualizar paquetes desde el escáner de vulnerabilidades). El resultado final trae la salida entera.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn exec_capture_stdin_live(
    app: AppHandle,
    sessions: State<'_, SessionStore>,
    registry: State<'_, ExecRegistry>,
    session_id: String,
    command: String,
    stdin: String,
    timeout_secs: u32,
    exec_id: String,
) -> AppResult<ExecResult> {
    let emit = |chunk: run::OutputChunk<'_>| {
        let _ = app.emit(EV_EXEC_OUTPUT, chunk);
    };
    run::run_live(&sessions, &registry, &session_id, &command, stdin, timeout_secs, &exec_id, &emit).await
}

/// Como `exec_capture`, pero el comando (escrito por el usuario, con uno o varios `sudo`, tuberías…)
/// corre dentro del envoltorio de `sudo.rs`, que da `password` a cada sudo sin ponerla en la línea de
/// comandos ni en el entorno. Lo usa «Ejecutar en varios servidores». La contraseña se comprueba una sola
/// vez (`sudo -k -S -v`): si es incorrecta no se ejecuta nada y vuelve `sudoFailure: "bad-password"`.
/// Se quita de la salida por si el comando la mostrara y se borra de memoria al terminar.
#[tauri::command]
pub async fn exec_capture_sudo(
    sessions: State<'_, SessionStore>,
    registry: State<'_, ExecRegistry>,
    session_id: String,
    command: String,
    password: String,
    timeout_secs: u32,
    exec_id: Option<String>,
) -> AppResult<SudoExecResult> {
    run::run_sudo(&sessions, &registry, &session_id, &command, password, timeout_secs, exec_id.as_deref()).await
}

/// Cancela una ejecución en curso (`exec_capture` / `exec_capture_stdin` con `exec_id`):
/// detiene el proceso remoto. Devuelve false si ya había terminado o no existe.
#[tauri::command]
pub async fn exec_cancel(registry: State<'_, ExecRegistry>, exec_id: String) -> AppResult<bool> {
    Ok(registry.cancel(&exec_id))
}
