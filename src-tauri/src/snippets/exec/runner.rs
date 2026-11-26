//! El bucle de la ejecución: enviar el arranque y el comando, leer la salida (y pasarla en vivo si
//! se pide), y detener el proceso remoto al cancelar o vencer el tiempo.

use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use super::channel::{stop_remote, Flow, Output};
use super::{bootstrap, clamp_timeout};
use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use crate::types::ExecResult;

/// Recibe la salida según llega: (es stderr, texto). Sin la marca de PID del arranque.
pub type OutputSink<'a> = &'a (dyn Fn(bool, &str) + Send + Sync);

/// Envía a `sink` lo nuevo de `buf` desde `sent`. Un carácter UTF-8 cortado al final espera al
/// siguiente trozo; `all` = enviar todo lo que quede.
fn emit_new(buf: &[u8], sent: &mut usize, stderr: bool, all: bool, sink: OutputSink<'_>) {
    let new = &buf[(*sent).min(buf.len())..];
    if new.is_empty() {
        return;
    }
    let take = match std::str::from_utf8(new) {
        Ok(_) => new.len(),
        Err(e) if e.error_len().is_none() && !all => e.valid_up_to(),
        Err(_) => new.len(),
    };
    if take > 0 {
        sink(stderr, &String::from_utf8_lossy(&new[..take]));
        *sent += take;
    }
}

pub(super) async fn run_core(
    session: &SshSession,
    command: &str,
    stdin: Option<&[u8]>,
    timeout_secs: u32,
    cancel: Option<&CancellationToken>,
    channel_signals: bool,
    sink: Option<OutputSink<'_>>,
) -> AppResult<ExecResult> {
    if command.trim().is_empty() {
        return Err(AppError::Invalid("El comando está vacío".into()));
    }
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        return Err(AppError::Canceled);
    }
    let started = Instant::now();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(clamp_timeout(timeout_secs));

    let channel = session.open_channel().await?;
    channel.exec(true, bootstrap(command.len())).await?;
    let (mut reader, writer) = channel.split();

    // Por stdin va primero el comando real (lo lee el arranque) y después, si hay, la entrada del usuario
    // con EOF. Sin entrada no se envía EOF (como antes: el comando ve una entrada abierta sin datos).
    // Todo se escribe en paralelo con la lectura.
    let write_stdin = async {
        // Errores de escritura (p. ej. el comando ya terminó y cerró el canal) se ignoran:
        // el resultado real llega por el código de salida. Nunca se formatea `data`.
        if writer.data(command.as_bytes()).await.is_err() {
            return;
        }
        if let Some(data) = stdin
            && writer.data(data).await.is_ok()
        {
            let _ = writer.eof().await;
        }
    };
    tokio::pin!(write_stdin);
    let mut writing = true;

    let never = CancellationToken::new();
    let cancel_token = cancel.unwrap_or(&never);

    let mut out = Output::default();
    let mut timed_out = false;
    let mut canceled = false;
    let (mut sent_out, mut sent_err) = (0usize, 0usize);

    loop {
        let msg = tokio::select! {
            () = &mut write_stdin, if writing => {
                writing = false;
                continue;
            }
            () = cancel_token.cancelled() => {
                canceled = true;
                break;
            }
            r = tokio::time::timeout_at(deadline, reader.wait()) => r,
        };
        match msg {
            Err(_) => {
                timed_out = true;
                break;
            }
            Ok(msg) => match out.handle(msg) {
                Flow::Continue => {
                    if let Some(sink) = sink {
                        emit_new(&out.stdout, &mut sent_out, false, false, sink);
                        // stderr solo cuando ya se quitó la marca de PID.
                        if out.mark_search_done {
                            emit_new(&out.stderr, &mut sent_err, true, false, sink);
                        }
                    }
                }
                Flow::Closed => break,
                Flow::Rejected => {
                    let _ = writer.close().await;
                    return Err(AppError::Ssh("el servidor rechazó la ejecución del comando".into()));
                }
            },
        }
    }
    if let Some(sink) = sink {
        emit_new(&out.stdout, &mut sent_out, false, true, sink);
        emit_new(&out.stderr, &mut sent_err, true, true, sink);
    }

    if timed_out || canceled {
        stop_remote(session, &mut reader, &writer, &mut out, channel_signals).await;
        let _ = writer.eof().await;
        let _ = writer.close().await;
    }
    if canceled {
        return Err(AppError::Canceled);
    }

    let mut stderr_text = String::from_utf8_lossy(&out.stderr).into_owned();
    if let (None, Some(sig)) = (out.exit_code, out.signal) {
        if !stderr_text.is_empty() && !stderr_text.ends_with('\n') {
            stderr_text.push('\n');
        }
        stderr_text.push_str(&format!("[terminado por la señal {sig}]\n"));
    }

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: stderr_text,
        exit_code: out.exit_code,
        duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        truncated: out.truncated,
        timed_out,
    })
}

#[cfg(test)]
mod live_tests {
    use super::emit_new;
    use std::sync::Mutex;

    #[test]
    fn utf8_cut_in_half_waits_for_the_rest() {
        let got = Mutex::new(Vec::<String>::new());
        let sink = |_: bool, t: &str| got.lock().unwrap().push(t.to_string());
        let text = "Configurando ñandú".as_bytes();
        let cut = text.iter().position(|&b| b == 0xC3).unwrap() + 1; // mitad de «ñ»
        let mut sent = 0;
        emit_new(&text[..cut], &mut sent, false, false, &sink);
        emit_new(text, &mut sent, false, false, &sink);
        emit_new(text, &mut sent, false, true, &sink);
        assert_eq!(got.lock().unwrap().join(""), "Configurando ñandú");
        assert_eq!(got.lock().unwrap().len(), 2);
    }
}
