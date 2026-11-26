//! Ejecutar un comando en un canal `exec` aparte (sin PTY) y capturar su salida.
//!
//! Cómo se detiene el comando remoto (al cancelar o al vencer el tiempo):
//! 1. Se pide al servidor la señal TERM por el propio canal. OpenSSH 7.9 o más nuevo la envía a todo
//!    el grupo de procesos del comando; servidores más viejos (y otros) la ignoran.
//! 2. Si el canal no se cierra en un momento, se abre OTRO canal y se ejecuta `kill -TERM -GRUPO`,
//!    y después se repite con KILL (la señal KILL también se pide por el canal).
//!    Cerrar el canal no basta: sin PTY, el proceso remoto sigue vivo.
//!
//! Para saber qué grupo matar, el comando no se envía tal cual: se envía un arranque corto
//! (ver [`bootstrap`]) que escribe su PID en stderr (esa línea se quita antes de devolver la salida),
//! lee el comando real por stdin y lo ejecuta con el shell de login del usuario, como antes.

mod channel;
mod runner;
mod mark;
mod registry;

use tokio_util::sync::CancellationToken;

use crate::error::AppResult;
use crate::ssh::SshSession;
use crate::types::ExecResult;

pub use runner::OutputSink;
pub use mark::bootstrap;
#[cfg(test)]
pub use mark::{take_pid_mark, RemoteTarget};
pub use registry::ExecRegistry;

/// Límite por flujo (stdout y stderr por separado).
pub const MAX_STREAM_BYTES: usize = 2 * 1024 * 1024;

pub fn clamp_timeout(secs: u32) -> u64 {
    u64::from(secs.clamp(1, 600))
}

/// Añade `data` a `buf` sin pasar de `MAX_STREAM_BYTES`. Devuelve true si hubo que recortar.
fn push_limited(buf: &mut Vec<u8>, data: &[u8]) -> bool {
    let room = MAX_STREAM_BYTES.saturating_sub(buf.len());
    if data.len() <= room {
        buf.extend_from_slice(data);
        false
    } else {
        buf.extend_from_slice(&data[..room]);
        true
    }
}

// ───────────── Ejecución ─────────────

/// Ejecuta `command` y espera a que termine o venza `timeout_secs` (1..=600).
pub async fn run(session: &SshSession, command: &str, timeout_secs: u32) -> AppResult<ExecResult> {
    run_inner(session, command, None, timeout_secs, None, true).await
}

/// Como [`run`], pero escribe `stdin` en la entrada estándar del comando y después envía EOF.
///
/// `stdin` puede contener contraseñas: NUNCA se registra ni se incluye en mensajes de error.
/// Se escribe a la vez que se lee la salida (un comando que no lee su entrada no bloquea la lectura).
pub async fn run_with_stdin(
    session: &SshSession,
    command: &str,
    stdin: &[u8],
    timeout_secs: u32,
) -> AppResult<ExecResult> {
    run_inner(session, command, Some(stdin), timeout_secs, None, true).await
}

/// Como [`run`] / [`run_with_stdin`], pero se puede cancelar con `cancel`: entonces se detiene el
/// proceso remoto y devuelve `AppError::Canceled`.
pub async fn run_cancellable(
    session: &SshSession,
    command: &str,
    stdin: Option<&[u8]>,
    timeout_secs: u32,
    cancel: &CancellationToken,
) -> AppResult<ExecResult> {
    run_inner(session, command, stdin, timeout_secs, Some(cancel), true).await
}

/// Como [`run_cancellable`], pero además pasa la salida a `sink` según llega (para mostrarla en vivo).
pub async fn run_live(
    session: &SshSession,
    command: &str,
    stdin: Option<&[u8]>,
    timeout_secs: u32,
    cancel: &CancellationToken,
    sink: OutputSink<'_>,
) -> AppResult<ExecResult> {
    runner::run_core(session, command, stdin, timeout_secs, Some(cancel), true, Some(sink)).await
}

pub(super) async fn run_inner(
    session: &SshSession,
    command: &str,
    stdin: Option<&[u8]>,
    timeout_secs: u32,
    cancel: Option<&CancellationToken>,
    channel_signals: bool,
) -> AppResult<ExecResult> {
    runner::run_core(session, command, stdin, timeout_secs, cancel, channel_signals, None).await
}
