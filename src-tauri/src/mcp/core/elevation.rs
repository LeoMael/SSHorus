//! sudo en los comandos del asistente (`run_command`, `run_catalog_command`), ya aprobados: la interfaz
//! consigue la contraseña igual que los paneles (en memoria → guardada → otra pestaña → diálogo; ver
//! `src/features/mcp/sudoAsk.ts`) y va por stdin al envoltorio de `sudo.rs`. El asistente nunca la ve.
//! `request_sudo_password` (sudo_reveal.rs) la pide por el mismo camino.

use std::time::Duration;

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use super::super::backend::Backend;
use super::super::sudo;
use super::output::{exec_summary, format_exec};
use super::{Fail, McpCore, Rec, Res, Target, DEFAULT_OUTPUT_KB, DEFAULT_TIMEOUT_SECS, MAX_OUTPUT_KB};
use crate::types::ExecResult;

/// Tiempo mínimo para escribir la contraseña de sudo en SSHorus (s) y margen para comprobarla.
const MIN_SUDO_ASK_SECS: u32 = 60;
const SUDO_ASK_MARGIN_SECS: u64 = 30;

pub const SUDO_CANCELED_MSG: &str = "El usuario no dio la contraseña de sudo en SSHorus (cerró el diálogo o \
no respondió a tiempo): no se ejecutó el comando. Si hace falta sudo, pídele que la escriba en SSHorus o que \
la guarde en el servidor (Editar servidor → Contraseña de sudo) y vuelve a intentarlo.";

/// Por qué no hace falta contraseña (respuesta de la interfaz `why`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NoPassword {
    Root,
    /// sudo sin contraseña (o no se sabe: si sobra, sudo lo dirá).
    NoPasswd,
    /// sudo no está instalado y el usuario no es root.
    NoSudo,
}

/// Respuesta de la interfaz a «sudo» o «sudo-reveal».
pub(super) enum SudoAnswer {
    /// Ya comprobada con sudo en esa conexión. Se borra de memoria al soltarla.
    Password(Zeroizing<String>),
    NotNeeded(NoPassword),
    /// El usuario cerró el diálogo o no respondió a tiempo.
    Canceled,
}

/// Para qué se pide (cambia el texto del diálogo de la contraseña).
pub(super) enum SudoPurpose<'a> {
    /// Un comando ya aprobado: SSHorus se la da a sudo.
    Command,
    /// `request_sudo_password`, ya aprobado: se le da a la IA. Lleva el motivo que dio.
    Reveal(&'a str),
}

impl<B: Backend> McpCore<B> {
    /// Ejecuta un comando ya aprobado. Con `sudo`, SSHorus pone la contraseña (o lo ejecuta tal cual si no
    /// hace falta: root, sudo sin contraseña).
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn exec(
        &self,
        rec: &mut Rec,
        t: &Target,
        session_id: &str,
        command: &str,
        sudo: bool,
        timeout_secs: Option<u32>,
        max_output_kb: Option<u32>,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let timeout = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, 600);
        let max = (max_output_kb.unwrap_or(DEFAULT_OUTPUT_KB).clamp(1, MAX_OUTPUT_KB) as usize) * 1024;
        let why = if sudo {
            match self.ask_sudo(rec, t, session_id, SudoPurpose::Command).await.map_err(not_run)? {
                SudoAnswer::Password(pw) => return self.exec_with_password(rec, t, session_id, command, &pw, timeout, max, cancel).await,
                SudoAnswer::Canceled => return Err(Fail::Denied(SUDO_CANCELED_MSG.into())),
                SudoAnswer::NotNeeded(NoPassword::NoSudo) => return Err(not_run(Fail::Error(no_sudo_msg(&t.server.name, &t.server.username)))),
                SudoAnswer::NotNeeded(why) => Some(why),
            }
        } else {
            None
        };
        let r = self.exec_raw(rec, session_id, command, None, timeout, cancel).await?;
        rec.entry.message = Some(exec_summary(&r));
        let mut out = format_exec(&r, max);
        self.redact_known(t, session_id, &mut out, &[]).await;
        if let Some(hint) = why.and_then(|w| raw_sudo_hint(w, &r, &t.server.name)) {
            out.push_str("\n\n");
            out.push_str(&hint);
        }
        Ok(out)
    }

    #[allow(clippy::too_many_arguments)]
    async fn exec_with_password(
        &self,
        rec: &mut Rec,
        t: &Target,
        session_id: &str,
        command: &str,
        password: &str,
        timeout: u32,
        max: usize,
        cancel: &CancellationToken,
    ) -> Res<String> {
        let r = self.exec_sudo_raw(rec, t, session_id, command, password, timeout, cancel).await?;
        rec.entry.message = Some(format!("{} (con sudo)", exec_summary(&r)));
        let mut out = format_exec(&r, max);
        self.redact_known(t, session_id, &mut out, &[]).await;
        Ok(out)
    }

    /// Ejecuta `command` (con `sudo …`) dándole a sudo la contraseña por el envoltorio de `sudo.rs`. Devuelve
    /// la salida ya sin la contraseña; si sudo la rechaza, avisa a la interfaz para que la olvide.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn exec_sudo_raw(
        &self,
        rec: &mut Rec,
        t: &Target,
        session_id: &str,
        command: &str,
        password: &str,
        timeout: u32,
        cancel: &CancellationToken,
    ) -> Res<ExecResult> {
        let wrapped = sudo::wrap(command, password).map_err(Fail::Error)?;
        let result = self.exec_raw(rec, session_id, &wrapped.command, Some(&wrapped.stdin), timeout, cancel).await;
        drop(wrapped); // borra el script y la contraseña del stdin
        let mut r = result?;
        sudo::redact(&mut r.stdout, password);
        sudo::redact(&mut r.stderr, password);
        if let Some(f) = sudo::failure(r.exit_code, &r.stderr) {
            if f == sudo::SudoFailure::BadPassword {
                // Igual que la interfaz: se olvida la de memoria y la guardada queda como rechazada.
                let payload = json!({ "sessionId": session_id, "serverName": t.server.name });
                if let Err(e) = self.backend.ui_request("sudo-rejected", payload, Duration::from_secs(10)).await {
                    log::warn!("MCP: no se pudo avisar a la interfaz de la contraseña de sudo rechazada: {e}");
                }
            }
            return Err(Fail::Error(sudo::failure_message(f, &t.server.name)));
        }
        Ok(r)
    }

    /// Pide a la interfaz la contraseña de sudo de la conexión (en memoria → guardada → otra pestaña →
    /// diálogo, según el ajuste del servidor). Se corta en cuanto SSHorus se bloquea.
    pub(super) async fn ask_sudo(&self, rec: &mut Rec, t: &Target, session_id: &str, purpose: SudoPurpose<'_>) -> Res<SudoAnswer> {
        let secs = self.config.get().approval_timeout_secs.max(MIN_SUDO_ASK_SECS);
        rec.entry.message = Some("Buscando la contraseña de sudo en SSHorus".into());
        self.audit.record(rec.entry.clone());
        rec.entry.message = None;
        let mut payload = json!({
            "sessionId": session_id,
            "profileId": t.server.id,
            "serverName": t.server.name,
            "timeoutSecs": secs,
            "auto": rec.entry.auto,
        });
        let kind = match purpose {
            SudoPurpose::Command => "sudo",
            SudoPurpose::Reveal(reason) => {
                payload["reason"] = Value::String(reason.to_string());
                "sudo-reveal"
            }
        };
        let wait = Duration::from_secs(u64::from(secs) + SUDO_ASK_MARGIN_SECS);
        let answer = self.unless_locked(self.backend.ui_request(kind, payload, wait)).await?;
        let v = answer.map_err(|e| Fail::Error(format!("No se pudo conseguir la contraseña de sudo en SSHorus: {e}.")))?;
        sudo_answer(v)
    }
}

/// Un error antes de ejecutar: se dice que no se ejecutó.
fn not_run(f: Fail) -> Fail {
    match f {
        Fail::Error(m) => Fail::Error(format!("{m} No se ejecutó el comando.")),
        other => other,
    }
}

pub(super) fn no_sudo_msg(server: &str, user: &str) -> String {
    format!(
        "sudo no está instalado en «{server}» y el usuario «{user}» no es root. Quita sudo si no hace falta, \
         o pide al usuario que instale sudo o se conecte como root."
    )
}

/// Pista para la IA cuando un comando con sudo se ejecutó sin contraseña y sudo falló por eso.
pub(super) fn raw_sudo_hint(why: NoPassword, r: &ExecResult, server: &str) -> Option<String> {
    let err = r.stderr.to_lowercase();
    if why == NoPassword::Root && r.exit_code == Some(127) && err.contains("sudo") && err.contains("not found") {
        return Some(format!("Nota: estás conectado como root en «{server}» y sudo no está instalado: quita «sudo» del comando."));
    }
    let asked = err.contains("a password is required") || err.contains("a terminal is required");
    (why != NoPassword::Root && err.contains("sudo") && asked).then(|| {
        format!(
            "Nota: sudo pidió contraseña en «{server}», pero SSHorus había comprobado que no hacía falta. Pide al \
             usuario que reconecte la pestaña (SSHorus vuelve a comprobar sus privilegios) y vuelve a intentarlo."
        )
    })
}

/// Respuesta de la interfaz: `{ elevate: true, password }`, `{ elevate: false, why? }` (no hace falta;
/// `why`: "root", "nopasswd" o "no-sudo") o `{ canceled: true }`. La contraseña se saca sin copiarla.
pub(super) fn sudo_answer(v: Value) -> Res<SudoAnswer> {
    let invalid = || Fail::Error("La ventana de SSHorus respondió algo no válido a la petición de sudo.".into());
    let Value::Object(mut m) = v else { return Err(invalid()) };
    if m.get("canceled").and_then(Value::as_bool) == Some(true) {
        return Ok(SudoAnswer::Canceled);
    }
    match m.remove("password") {
        Some(Value::String(pw)) if !pw.is_empty() => Ok(SudoAnswer::Password(Zeroizing::new(pw))),
        Some(Value::String(pw)) => {
            drop(Zeroizing::new(pw));
            Err(Fail::Error("La contraseña de sudo está vacía.".into()))
        }
        Some(_) => Err(invalid()),
        None => Ok(SudoAnswer::NotNeeded(match m.get("why").and_then(Value::as_str) {
            Some("root") => NoPassword::Root,
            Some("no-sudo") => NoPassword::NoSudo,
            _ => NoPassword::NoPasswd,
        })),
    }
}
