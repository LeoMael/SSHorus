//! Ejecutar un programa en un terminal (PTY) y escribirle la contraseña cuando la pida
//! (`run_with_password`).
//!
//! - El terminal se pide sin eco (`ECHO` = 0): lo que SSHorus escribe no vuelve en la salida.
//! - Cada vez que el programa deja una pregunta de contraseña a medias (`prompt.rs`), se pide la respuesta
//!   por `prompts` (la da `core/password_run.rs`, que pregunta al usuario) y se escribe con un salto de línea.
//!   Mientras se espera al usuario no corre el tiempo límite.
//! - Si el programa repite una pregunta ya respondida (contraseña incorrecta, casi seguro), se detiene: así
//!   no se repiten intentos fallidos que podrían bloquear la cuenta. También tras `MAX_PROMPTS` preguntas.
//! - La salida se devuelve con cada contraseña escrita tapada (`redact.rs`), también si llegó partida en
//!   varios trozos (se tapa al final, sobre toda la salida).
//! - Las contraseñas solo viven en `Zeroizing` y nunca se registran.

use std::future::Future;
use std::time::Duration;

use russh::client::Msg;
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Pty, Sig};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use super::prompt::{normalized, PromptDetector};
use super::redact::redact_all;
use crate::error::AppResult;
use crate::ssh::SshSession;

/// Preguntas como mucho (p. ej. passwd como usuario: actual, nueva y repetir).
pub const MAX_PROMPTS: usize = 6;
/// Salida máxima que se guarda.
const MAX_OUTPUT: usize = 1024 * 1024;
/// Tras detener el programa, lo que se espera a que se cierre el canal.
const DRAIN: Duration = Duration::from_millis(1500);

/// Una pregunta del programa: la respuesta (None = no darla y detener el programa).
pub struct PromptAsk {
    pub prompt: String,
    pub reply: oneshot::Sender<Option<Zeroizing<String>>>,
}

#[derive(Debug, Clone)]
pub struct PtyOptions {
    /// Tiempo límite del programa (s, 1..=600), sin contar la espera al usuario.
    pub timeout_secs: u32,
    /// Texto de la pregunta, si no es una de contraseña de las de siempre.
    pub hint: Option<String>,
}

/// Por qué se detuvo el programa antes de terminar solo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyStop {
    /// Volvió a hacer una pregunta ya respondida.
    Repeated(String),
    /// El usuario no quiso dar la contraseña para esa pregunta.
    Refused(String),
    TooMany,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyOutcome {
    /// Salida del terminal (stdout y stderr juntos), con las contraseñas tapadas y saltos de línea `\n`.
    pub output: String,
    pub exit_code: Option<u32>,
    pub timed_out: bool,
    pub canceled: bool,
    pub truncated: bool,
    pub stop: Option<PtyStop>,
    /// Preguntas respondidas, en orden.
    pub prompts: Vec<String>,
}

pub enum PtyEvent {
    Data(Vec<u8>),
    Exit(u32),
    Closed,
}

/// El terminal del programa (en las pruebas, uno de mentira).
pub trait PtyIo: Send {
    fn next(&mut self) -> impl Future<Output = PtyEvent> + Send;
    /// Puede llevar una contraseña: nunca se registra.
    fn write(&mut self, data: &[u8]) -> impl Future<Output = ()> + Send;
    /// Detiene el programa (señal y cierre del canal).
    fn stop(&mut self) -> impl Future<Output = ()> + Send;
}

/// Lo que se va juntando.
#[derive(Default)]
struct Collected {
    out: Vec<u8>,
    truncated: bool,
    exit_code: Option<u32>,
}

impl Collected {
    fn push(&mut self, data: &[u8]) {
        let room = MAX_OUTPUT.saturating_sub(self.out.len());
        let take = data.len().min(room);
        self.out.extend_from_slice(&data[..take]);
        self.truncated |= take < data.len();
    }
}

enum Step {
    Go,
    Stop(PtyStop),
    Canceled,
}

/// Ejecuta el diálogo con el programa hasta que termine, venza el tiempo, se cancele o haya que pararlo.
pub async fn drive<P: PtyIo>(
    io: &mut P,
    opts: &PtyOptions,
    cancel: &CancellationToken,
    prompts: &mpsc::Sender<PromptAsk>,
) -> PtyOutcome {
    let mut deadline = Instant::now() + Duration::from_secs(u64::from(opts.timeout_secs.clamp(1, 600)));
    let mut got = Collected::default();
    let mut detector = PromptDetector::default();
    let mut given: Vec<Zeroizing<String>> = Vec::new();
    let mut asked: Vec<String> = Vec::new();
    let (mut timed_out, mut canceled, mut stop) = (false, false, None);
    loop {
        let ev = tokio::select! {
            () = cancel.cancelled() => { canceled = true; break; }
            r = tokio::time::timeout_at(deadline, io.next()) => r,
        };
        let data = match ev {
            Err(_) => {
                timed_out = true;
                break;
            }
            Ok(PtyEvent::Closed) => break,
            Ok(PtyEvent::Exit(code)) => {
                got.exit_code = Some(code);
                continue;
            }
            Ok(PtyEvent::Data(d)) => d,
        };
        got.push(&data);
        detector.push(&data);
        let Some(prompt) = detector.prompt(opts.hint.as_deref()) else { continue };
        let step = if asked.iter().any(|a| normalized(a) == normalized(&prompt)) {
            Step::Stop(PtyStop::Repeated(prompt))
        } else if asked.len() >= MAX_PROMPTS {
            Step::Stop(PtyStop::TooMany)
        } else {
            let waited = Instant::now();
            let step = answer(io, &prompt, cancel, prompts, &mut given).await;
            deadline += waited.elapsed();
            if matches!(step, Step::Go) {
                detector.answered();
                asked.push(prompt);
            }
            step
        };
        match step {
            Step::Go => {}
            Step::Stop(s) => {
                stop = Some(s);
                break;
            }
            Step::Canceled => {
                canceled = true;
                break;
            }
        }
    }
    if timed_out || canceled || stop.is_some() {
        io.stop().await;
        drain(io, &mut got).await;
    }
    let mut output = String::from_utf8_lossy(&got.out).into_owned();
    let secrets: Vec<&str> = given.iter().map(|s| s.as_str()).collect();
    redact_all(&mut output, &secrets, got.truncated);
    PtyOutcome {
        output: output.replace("\r\n", "\n"),
        exit_code: got.exit_code,
        timed_out,
        canceled,
        truncated: got.truncated,
        stop,
        prompts: asked,
    }
}

/// Pide la respuesta a `prompts` y la escribe.
async fn answer<P: PtyIo>(
    io: &mut P,
    prompt: &str,
    cancel: &CancellationToken,
    prompts: &mpsc::Sender<PromptAsk>,
    given: &mut Vec<Zeroizing<String>>,
) -> Step {
    let (tx, rx) = oneshot::channel();
    if prompts.send(PromptAsk { prompt: prompt.to_string(), reply: tx }).await.is_err() {
        return Step::Stop(PtyStop::Refused(prompt.to_string()));
    }
    let reply = tokio::select! {
        () = cancel.cancelled() => return Step::Canceled,
        r = rx => r.ok().flatten(),
    };
    let Some(secret) = reply.filter(|s| !s.is_empty() && !s.contains(['\n', '\r'])) else {
        return Step::Stop(PtyStop::Refused(prompt.to_string()));
    };
    let mut line = Zeroizing::new(Vec::with_capacity(secret.len() + 1));
    line.extend_from_slice(secret.as_bytes());
    line.push(b'\n');
    io.write(&line).await;
    given.push(secret);
    Step::Go
}

/// Lee lo que quede hasta que se cierre el canal (o pase `DRAIN`).
async fn drain<P: PtyIo>(io: &mut P, got: &mut Collected) {
    let until = Instant::now() + DRAIN;
    while let Ok(ev) = tokio::time::timeout_at(until, io.next()).await {
        match ev {
            PtyEvent::Data(d) => got.push(&d),
            PtyEvent::Exit(c) => got.exit_code = Some(c),
            PtyEvent::Closed => break,
        }
    }
}

// ───────────── Terminal de verdad: un canal SSH con PTY ─────────────

struct SshPty {
    reader: ChannelReadHalf,
    writer: ChannelWriteHalf<Msg>,
}

impl PtyIo for SshPty {
    async fn next(&mut self) -> PtyEvent {
        loop {
            match self.reader.wait().await {
                None | Some(ChannelMsg::Close) => return PtyEvent::Closed,
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    return PtyEvent::Data(data.to_vec());
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => return PtyEvent::Exit(exit_status),
                Some(_) => {}
            }
        }
    }

    async fn write(&mut self, data: &[u8]) {
        // Si el programa ya terminó, da igual: el resultado llega por la salida. Nunca se formatea `data`.
        let _ = self.writer.data(data).await;
    }

    async fn stop(&mut self) {
        let _ = self.writer.signal(Sig::TERM).await;
        // Al cerrar el canal, el servidor cierra el terminal y el programa recibe HUP.
        let _ = self.writer.eof().await;
        let _ = self.writer.close().await;
    }
}

/// Ejecuta `command` en un terminal nuevo de la conexión y le contesta las preguntas de contraseña.
pub async fn run_ssh(
    session: &SshSession,
    command: &str,
    opts: &PtyOptions,
    cancel: &CancellationToken,
    prompts: &mpsc::Sender<PromptAsk>,
) -> AppResult<PtyOutcome> {
    let channel = session.open_channel().await?;
    channel.request_pty(false, "dumb", 160, 40, 0, 0, &[(Pty::ECHO, 0)]).await?;
    channel.exec(true, command.as_bytes()).await?;
    let (reader, writer) = channel.split();
    let mut io = SshPty { reader, writer };
    let out = drive(&mut io, opts, cancel, prompts).await;
    let _ = io.writer.close().await;
    Ok(out)
}

#[cfg(test)]
#[path = "pty_run_tests.rs"]
pub(crate) mod tests;
