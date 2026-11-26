//! Ejecutar desde la interfaz: con registro para poder cancelar, con `stdin` que se borra de
//! memoria al terminar, con la salida en vivo por evento y dentro del envoltorio de sudo.

use serde::Serialize;
use zeroize::Zeroizing;

use super::{exec, sudo, ExecRegistry};
use crate::error::AppResult;
use crate::ssh::SessionStore;
use crate::types::ExecResult;

/// Evento con la salida de `exec_capture_stdin_live` según llega.
pub const EV_EXEC_OUTPUT: &str = "exec://output";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk<'a> {
    exec_id: &'a str,
    stderr: bool,
    text: &'a str,
}

/// Resultado de `exec_capture_sudo`: el del comando y, si sudo falló antes de ejecutarlo, por qué.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SudoExecResult {
    #[serde(flatten)]
    pub result: ExecResult,
    /// "bad-password", "denied", "tty-required", "no-temp" o "no-sudo" (None = sudo aceptó la contraseña).
    pub sudo_failure: Option<&'static str>,
}

/// Ejecuta `command` (con `stdin` opcional). Con `exec_id` queda registrado y se puede cancelar.
pub async fn run_registered(
    sessions: &SessionStore,
    registry: &ExecRegistry,
    session_id: &str,
    command: &str,
    stdin: Option<&[u8]>,
    timeout_secs: u32,
    exec_id: Option<&str>,
) -> AppResult<ExecResult> {
    let ticket = exec_id.map(|id| registry.register(id)).transpose()?;
    let session = sessions.get(session_id).await?;
    match &ticket {
        Some(t) => exec::run_cancellable(&session, command, stdin, timeout_secs, &t.token).await,
        None => match stdin {
            Some(data) => exec::run_with_stdin(&session, command, data, timeout_secs).await,
            None => exec::run(&session, command, timeout_secs).await,
        },
    }
}

/// Como [`run_registered`], pero `stdin` se borra de memoria al terminar (puede llevar contraseñas).
pub async fn run_with_secret_stdin(
    sessions: &SessionStore,
    registry: &ExecRegistry,
    session_id: &str,
    command: &str,
    stdin: String,
    timeout_secs: u32,
    exec_id: Option<&str>,
) -> AppResult<ExecResult> {
    let mut stdin = stdin.into_bytes();
    let result = run_registered(sessions, registry, session_id, command, Some(&stdin), timeout_secs, exec_id).await;
    wipe(&mut stdin);
    result
}

/// Como [`run_with_secret_stdin`] (siempre cancelable), pero además pasa la salida a `emit` según
/// llega (`OutputChunk`, para el evento `EV_EXEC_OUTPUT`).
#[allow(clippy::too_many_arguments)]
pub async fn run_live(
    sessions: &SessionStore,
    registry: &ExecRegistry,
    session_id: &str,
    command: &str,
    stdin: String,
    timeout_secs: u32,
    exec_id: &str,
    emit: &(dyn Fn(OutputChunk<'_>) + Send + Sync),
) -> AppResult<ExecResult> {
    let mut stdin = stdin.into_bytes();
    let result = async {
        let ticket = registry.register(exec_id)?;
        let session = sessions.get(session_id).await?;
        let sink = |stderr: bool, text: &str| emit(OutputChunk { exec_id, stderr, text });
        exec::run_live(&session, command, Some(&stdin), timeout_secs, &ticket.token, &sink).await
    }
    .await;
    wipe(&mut stdin);
    result
}

/// Ejecuta `command` dentro del envoltorio de `sudo.rs` con `password` (ver `exec_capture_sudo`).
pub async fn run_sudo(
    sessions: &SessionStore,
    registry: &ExecRegistry,
    session_id: &str,
    command: &str,
    password: String,
    timeout_secs: u32,
    exec_id: Option<&str>,
) -> AppResult<SudoExecResult> {
    let password = Zeroizing::new(password);
    let wrapped = sudo::wrap(command, &password).map_err(crate::error::AppError::Invalid)?;
    let result = run_registered(
        sessions,
        registry,
        session_id,
        &wrapped.command,
        Some(&wrapped.stdin),
        timeout_secs,
        exec_id,
    )
    .await;
    drop(wrapped); // borra el script y la contraseña del stdin
    let mut r = result?;
    sudo::redact(&mut r.stdout, &password);
    sudo::redact(&mut r.stderr, &password);
    let sudo_failure = sudo::failure(r.exit_code, &r.stderr).map(sudo::SudoFailure::key);
    Ok(SudoExecResult { result: r, sudo_failure })
}

/// Sobrescribe el búfer con ceros (lo mejor que se puede hacer sin dependencias extra).
fn wipe(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // SAFETY: `b` es una referencia válida y alineada a un u8 del propio búfer.
        unsafe { std::ptr::write_volatile(b, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}
