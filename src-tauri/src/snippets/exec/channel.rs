//! Leer la salida del canal (con límite y quitando la marca de PID) y detener el proceso remoto al
//! cancelar o vencer el tiempo: TERM, espera, KILL (ver el comentario de `exec`).

use std::time::Duration;

use russh::client::Msg;
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Sig};

use super::mark::{take_pid_mark, RemoteTarget, MARK_SEARCH_LIMIT};
use super::push_limited;
use crate::ssh::SshSession;

/// Espera tras pedir TERM (y luego KILL) antes de pasar al siguiente paso.
const GRACE: Duration = Duration::from_millis(1500);
/// Espera final tras el último intento.
const LAST_WAIT: Duration = Duration::from_millis(1000);
/// Tiempo máximo del canal auxiliar que ejecuta `kill`.
const KILL_EXEC_TIMEOUT: Duration = Duration::from_secs(5);

/// Lo que se va leyendo del canal.
#[derive(Default)]
pub(super) struct Output {
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    pub(super) truncated: bool,
    pub(super) exit_code: Option<u32>,
    pub(super) signal: Option<String>,
    target: Option<RemoteTarget>,
    pub(super) mark_search_done: bool,
}

pub(super) enum Flow {
    Continue,
    Closed,
    Rejected,
}

impl Output {
    pub(super) fn handle(&mut self, msg: Option<ChannelMsg>) -> Flow {
        let Some(msg) = msg else { return Flow::Closed };
        match msg {
            ChannelMsg::Data { data } => self.truncated |= push_limited(&mut self.stdout, &data),
            ChannelMsg::ExtendedData { data, ext: 1 } => {
                self.truncated |= push_limited(&mut self.stderr, &data);
                if !self.mark_search_done {
                    if let Some(t) = take_pid_mark(&mut self.stderr) {
                        self.target = Some(t);
                        self.mark_search_done = true;
                    } else if self.stderr.len() > MARK_SEARCH_LIMIT {
                        self.mark_search_done = true;
                    }
                }
            }
            ChannelMsg::ExitStatus { exit_status } => self.exit_code = Some(exit_status),
            ChannelMsg::ExitSignal { signal_name, .. } => self.signal = Some(format!("{signal_name:?}")),
            ChannelMsg::Failure => return Flow::Rejected,
            ChannelMsg::Close => return Flow::Closed,
            _ => {}
        }
        Flow::Continue
    }
}

/// Lee del canal hasta que se cierre (true) o pase `wait` (false).
async fn read_until_closed(reader: &mut ChannelReadHalf, out: &mut Output, wait: Duration) -> bool {
    let until = tokio::time::Instant::now() + wait;
    loop {
        match tokio::time::timeout_at(until, reader.wait()).await {
            Err(_) => return false,
            Ok(msg) => match out.handle(msg) {
                Flow::Continue => {}
                Flow::Closed | Flow::Rejected => return true,
            },
        }
    }
}

/// Ejecuta `command` (sin arranque) en otro canal y espera a que termine. Errores ignorados.
async fn exec_aux(session: &SshSession, command: &str) {
    let job = async {
        let channel = session.open_channel().await.ok()?;
        channel.exec(true, command.as_bytes()).await.ok()?;
        let (mut reader, writer) = channel.split();
        while let Some(msg) = reader.wait().await {
            if matches!(msg, ChannelMsg::Close) {
                break;
            }
        }
        let _ = writer.close().await;
        Some(())
    };
    let _ = tokio::time::timeout(KILL_EXEC_TIMEOUT, job).await;
}

/// Detiene el comando remoto: TERM, espera, KILL. Ver el comentario del módulo.
/// `channel_signals` = false solo en pruebas (simula un servidor que ignora las señales del canal).
pub(super) async fn stop_remote(
    session: &SshSession,
    reader: &mut ChannelReadHalf,
    writer: &ChannelWriteHalf<Msg>,
    out: &mut Output,
    channel_signals: bool,
) {
    for (sig, sig_name) in [(Sig::TERM, "TERM"), (Sig::KILL, "KILL")] {
        if channel_signals {
            let _ = writer.signal(sig).await;
            if read_until_closed(reader, out, GRACE).await {
                return;
            }
        }
        // Respaldo: el servidor ignoró la señal (o el proceso la ignora). Si aún no llegó la marca,
        // se le da un momento (el arranque la escribe enseguida).
        if out.target.is_none() && read_until_closed(reader, out, Duration::from_millis(300)).await {
            return;
        }
        if let Some(t) = out.target {
            exec_aux(session, &t.kill_command(sig_name)).await;
            if read_until_closed(reader, out, if sig_name == "KILL" { LAST_WAIT } else { GRACE }).await {
                return;
            }
        }
    }
}
