//! `run_with_password`: un programa que pide una contraseña por su cuenta (passwd, su, mysql -p,
//! ssh-keygen -p, docker login, git por HTTPS…) y no se puede lanzar con sudo delante.
//!
//! - Pregunta SIEMPRE con un diálogo propio en SSHorus (servidor, comando, motivo): sin «Permitir siempre»
//!   y sin «Aceptar automáticamente». Antes se aplican las reglas de acceso igual que en `run_command`
//!   (solo lectura, «Solo lo marcado», usuarios protegidos).
//! - En el diálogo el usuario elige la contraseña guardada del servidor (conexión o sudo), escribe otra o se
//!   niega. SSHorus la escribe cuando el programa la pide (`pty_run.rs`); si hay más preguntas, se usa la
//!   misma («la misma para todas») o se pregunta otra vez.
//! - La IA solo recibe la salida, con la contraseña tapada. Nunca va al registro, a la respuesta ni a disco.

use std::time::{Duration, Instant};

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use super::super::backend::{Backend, SavedPassword};
use super::super::policy::{self, Action};
use super::super::protect;
use super::super::pty_run::{PromptAsk, PtyOptions, PtyOutcome, PtyStop};
use super::output::clip_middle;
use super::sudo_reveal::clean_reason;
use super::{Fail, McpCore, Rec, Res, Target, DEFAULT_OUTPUT_KB, DEFAULT_TIMEOUT_SECS, MAX_OUTPUT_KB};

/// Tiempo mínimo para responder al diálogo (s) y margen de espera del motor.
const MIN_ASK_SECS: u32 = 60;
const ASK_MARGIN_SECS: u64 = 30;

pub const PASSWORD_DENIED_MSG: &str = "El usuario no permitió ejecutarlo en SSHorus (o no respondió a tiempo). \
No se ejecutó nada.";

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PasswordRunParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Comando exacto que pide la contraseña (p. ej. «passwd», «su - otro -c 'id'», «mysql -u root -p -e 'SHOW DATABASES'»).
    /// Sin la contraseña: SSHorus la escribe cuando el programa la pida.
    pub command: String,
    /// Para qué lo necesitas (el usuario lo lee tal cual en SSHorus). Sé concreto.
    pub reason: String,
    /// Texto de la pregunta si no dice password/contraseña/passphrase/clave (p. ej. «Token»).
    #[serde(default)]
    pub prompt_hint: Option<String>,
    /// Tiempo límite en segundos (1-600, por defecto 60), sin contar lo que tarde el usuario en responder.
    #[serde(default)]
    pub timeout_secs: Option<u32>,
    /// KB máximos de salida (por defecto 64, máximo 512).
    #[serde(default)]
    pub max_output_kb: Option<u32>,
}

/// Respuesta del usuario en los diálogos. Sin `Debug`: podría llevar la contraseña.
enum Reply {
    Canceled,
    Saved(SavedPassword),
    Typed(Zeroizing<String>),
    /// La misma que la pregunta número n (desde 0).
    Reuse(usize),
}

/// `{ canceled: true }`, `{ source: "login" | "sudo" }`, `{ password }` o `{ reuse: n }`; y `sameForAll`.
/// La contraseña se saca sin copiarla.
fn parse_reply(v: Value) -> Res<(Reply, bool)> {
    let invalid = || Fail::Error("La ventana de SSHorus respondió algo no válido.".into());
    let Value::Object(mut m) = v else { return Err(invalid()) };
    let same = m.get("sameForAll").and_then(Value::as_bool).unwrap_or(false);
    if m.get("canceled").and_then(Value::as_bool) == Some(true) {
        return Ok((Reply::Canceled, same));
    }
    if let Some(Value::String(pw)) = m.remove("password") {
        let pw = Zeroizing::new(pw);
        return Ok((Reply::Typed(pw), same));
    }
    let reply = match (m.get("source").and_then(Value::as_str), m.get("reuse").and_then(Value::as_u64)) {
        (Some("login"), _) => Reply::Saved(SavedPassword::Login),
        (Some("sudo"), _) => Reply::Saved(SavedPassword::Sudo),
        (None, Some(n)) => Reply::Reuse(usize::try_from(n).map_err(|_| invalid())?),
        _ => return Err(invalid()),
    };
    Ok((reply, same))
}

/// Contraseñas ya dadas en esta ejecución.
struct Given {
    first: Zeroizing<String>,
    same_for_all: bool,
    /// (pregunta, contraseña) en orden.
    answered: Vec<(String, Zeroizing<String>)>,
}

impl<B: Backend> McpCore<B> {
    pub(super) async fn run_with_password(&self, p: PasswordRunParams, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        let command = p.command.trim().to_string();
        rec.entry.detail = command.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        if command.is_empty() {
            return Err(Fail::Error("El comando está vacío.".into()));
        }
        let reason = clean_reason(&p.reason);
        if reason.is_empty() {
            return Err(Fail::Error("Falta el motivo (reason): explica al usuario para qué hace falta.".into()));
        }
        let sid = t.session_id()?.to_string();
        let protected = self.protected_in_command(&t, &command).await?;
        let mut danger = policy::danger_reasons(&command);
        if !protected.is_empty() {
            danger.insert(0, protect::warning(&protected));
        }
        self.precheck(&t, Action::change(format!("run_command\n{command}")).with_danger(danger.clone()).with_protected(protected))?;

        let hint = p.prompt_hint.as_deref().map(str::trim).filter(|h| !h.is_empty()).map(str::to_string);
        let payload = json!({
            "command": command,
            "reason": reason,
            "promptHint": hint,
            "danger": danger,
            "client": rec.entry.client,
        });
        rec.entry.message = Some("Esperando tu permiso en SSHorus".into());
        self.audit.record(rec.entry.clone());
        rec.entry.message = None;
        let (first, same_for_all) = match self.ask_password(&t, &sid, "password-run", payload).await? {
            (Reply::Canceled, _) | (Reply::Reuse(_), _) => {
                rec.entry.approved_by = Some("tú: denegado".into());
                return Err(Fail::Denied(PASSWORD_DENIED_MSG.into()));
            }
            (r, same) => (self.secret_of(&t, &sid, r, &[]).await?, same),
        };
        rec.entry.approved_by = Some("tú: una vez".into());

        let timeout = p.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, 600);
        let max = (p.max_output_kb.unwrap_or(DEFAULT_OUTPUT_KB).clamp(1, MAX_OUTPUT_KB) as usize) * 1024;
        let mut given = Given { first, same_for_all, answered: Vec::new() };
        let started = Instant::now();
        let out = self.drive_pty(rec, &t, &sid, &command, PtyOptions { timeout_secs: timeout, hint }, &mut given, cancel).await?;
        let mut text = describe(&out, started.elapsed(), max);
        let mut secrets: Vec<Zeroizing<String>> = given.answered.into_iter().map(|(_, s)| s).collect();
        secrets.push(given.first);
        self.redact_known(&t, &sid, &mut text, &secrets).await;
        rec.entry.message = Some(summary(&out));
        Ok(text)
    }

    /// Ejecuta en el terminal y contesta cada pregunta. Si SSHorus se bloquea mientras tanto, se detiene.
    #[allow(clippy::too_many_arguments)]
    async fn drive_pty(
        &self,
        rec: &mut Rec,
        t: &Target,
        sid: &str,
        command: &str,
        opts: PtyOptions,
        given: &mut Given,
        cancel: &CancellationToken,
    ) -> Res<PtyOutcome> {
        let exec_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
        rec.entry.exec_id = Some(exec_id.clone());
        rec.entry.message = Some("Ejecutando".into());
        self.audit.record(rec.entry.clone());
        rec.entry.message = None;

        let (tx, mut rx) = mpsc::channel::<PromptAsk>(1);
        let run = self.backend.run_pty(sid, command, opts, &exec_id, tx);
        tokio::pin!(run);
        let mut failed: Option<Fail> = None;
        let mut stopping = false;
        let result = loop {
            tokio::select! {
                r = &mut run => break r,
                Some(ask) = rx.recv() => {
                    let answer = match self.answer_prompt(t, sid, command, &ask.prompt, given).await {
                        Ok(a) => a,
                        Err(f) => {
                            failed.get_or_insert(f);
                            None
                        }
                    };
                    let _ = ask.reply.send(answer);
                }
                () = cancel.cancelled(), if !stopping => {
                    stopping = true;
                    self.backend.cancel_exec(&exec_id);
                }
            }
        };
        let out = result?;
        if let Some(f) = failed {
            return Err(f);
        }
        if out.canceled {
            return Err(Fail::Error("Se canceló el programa (y se detuvo en el servidor).".into()));
        }
        Ok(out)
    }

    /// Contraseña para una pregunta del programa. None = el usuario no la quiso dar.
    async fn answer_prompt(&self, t: &Target, sid: &str, command: &str, prompt: &str, given: &mut Given) -> Res<Option<Zeroizing<String>>> {
        let secret = if given.answered.is_empty() || given.same_for_all {
            given.first.clone()
        } else {
            let previous: Vec<&str> = given.answered.iter().map(|(p, _)| p.as_str()).collect();
            let payload = json!({ "command": command, "prompt": prompt, "previous": previous });
            match self.ask_password(t, sid, "password-prompt", payload).await?.0 {
                Reply::Canceled => return Ok(None),
                r => {
                    let prev: Vec<&Zeroizing<String>> = given.answered.iter().map(|(_, s)| s).collect();
                    self.secret_of(t, sid, r, &prev).await?
                }
            }
        };
        given.answered.push((prompt.to_string(), secret.clone()));
        Ok(Some(secret))
    }

    /// Muestra un diálogo de `run_with_password` y espera la respuesta (se corta si SSHorus se bloquea).
    async fn ask_password(&self, t: &Target, sid: &str, kind: &str, mut payload: Value) -> Res<(Reply, bool)> {
        let secs = self.config.get().approval_timeout_secs.max(MIN_ASK_SECS);
        let has = |k| self.backend.saved_password(&t.server.id, sid, k);
        let has_login = has(SavedPassword::Login).await.ok().flatten().is_some();
        let has_sudo = has(SavedPassword::Sudo).await.ok().flatten().is_some();
        if let Value::Object(m) = &mut payload {
            m.insert("sessionId".into(), json!(sid));
            m.insert("profileId".into(), json!(t.server.id));
            m.insert("serverName".into(), json!(t.server.name));
            m.insert("user".into(), json!(t.server.username));
            m.insert("hasLogin".into(), json!(has_login));
            m.insert("hasSudo".into(), json!(has_sudo));
            m.insert("timeoutSecs".into(), json!(secs));
        }
        let wait = Duration::from_secs(u64::from(secs) + ASK_MARGIN_SECS);
        let answer = self.unless_locked(self.backend.ui_request(kind, payload, wait)).await?;
        match answer {
            Ok(v) => parse_reply(v),
            Err(_) => Ok((Reply::Canceled, false)),
        }
    }

    /// La contraseña que eligió el usuario.
    async fn secret_of(&self, t: &Target, sid: &str, r: Reply, previous: &[&Zeroizing<String>]) -> Res<Zeroizing<String>> {
        let secret = match r {
            Reply::Typed(s) => s,
            Reply::Saved(k) => self.backend.saved_password(&t.server.id, sid, k).await?.ok_or_else(|| {
                Fail::Error(format!("«{}» no tiene esa contraseña guardada: no se ejecutó nada.", t.server.name))
            })?,
            Reply::Reuse(n) => previous.get(n).map(|s| (*s).clone()).ok_or_else(|| Fail::Error("Esa respuesta no existe.".into()))?,
            Reply::Canceled => return Err(Fail::Denied(PASSWORD_DENIED_MSG.into())),
        };
        if secret.is_empty() || secret.contains(['\n', '\r']) {
            return Err(Fail::Error("La contraseña está vacía o tiene saltos de línea: no se escribió.".into()));
        }
        Ok(secret)
    }
}

/// Texto para la IA (la salida ya viene con las contraseñas tapadas).
fn describe(o: &PtyOutcome, took: Duration, max: usize) -> String {
    let code = o.exit_code.map_or_else(|| "desconocido".to_string(), |c| c.to_string());
    let mut head = format!("Código de salida: {code} · {:.1} s", took.as_secs_f64());
    if o.timed_out {
        head.push_str(" · SE CORTÓ POR TIEMPO (el programa se detuvo)");
    }
    let output = clip_middle(&o.output, max);
    if o.truncated || output.len() != o.output.len() {
        head.push_str(" · salida recortada");
    }
    let mut notes = Vec::new();
    if o.prompts.is_empty() {
        notes.push("El programa no pidió ninguna contraseña: no se escribió nada.".to_string());
    } else {
        let list: Vec<String> = o.prompts.iter().map(|p| format!("«{p}»")).collect();
        notes.push(format!("SSHorus escribió la contraseña en: {} (tú no la ves; en la salida sale como ••••).", list.join(", ")));
    }
    match &o.stop {
        Some(PtyStop::Repeated(p)) => notes.push(format!(
            "El programa volvió a preguntar «{p}»: casi seguro la contraseña no vale. SSHorus lo detuvo para no repetir intentos."
        )),
        Some(PtyStop::Refused(p)) => notes.push(format!("El usuario no quiso dar la contraseña para «{p}»: se detuvo el programa.")),
        Some(PtyStop::TooMany) => notes.push("El programa hizo demasiadas preguntas: se detuvo.".into()),
        None => {}
    }
    format!("{head}\n{}\n--- salida (terminal) ---\n{output}", notes.join("\n"))
}

fn summary(o: &PtyOutcome) -> String {
    let code = match (o.timed_out, o.exit_code) {
        (true, _) => "se cortó por tiempo".to_string(),
        (false, Some(c)) => format!("código {c}"),
        (false, None) => "sin código de salida".into(),
    };
    format!("{code} · contraseña escrita {} vez/veces", o.prompts.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respuestas_del_dialogo() {
        assert!(matches!(parse_reply(json!({ "canceled": true })).unwrap(), (Reply::Canceled, false)));
        assert!(matches!(parse_reply(json!({ "source": "login", "sameForAll": true })).unwrap(), (Reply::Saved(SavedPassword::Login), true)));
        assert!(matches!(parse_reply(json!({ "source": "sudo" })).unwrap(), (Reply::Saved(SavedPassword::Sudo), false)));
        assert!(matches!(parse_reply(json!({ "reuse": 1 })).unwrap(), (Reply::Reuse(1), false)));
        let typed = parse_reply(json!({ "password": "x1", "sameForAll": false })).ok();
        assert!(matches!(typed, Some((Reply::Typed(ref p), false)) if p.as_str() == "x1"));
        assert!(parse_reply(json!({ "source": "otra" })).is_err());
        assert!(parse_reply(json!("hola")).is_err());
    }
}
