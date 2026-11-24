//! `reboot_server`: reinicia un servidor avisando antes al vigilante SSH (`ssh::reboot_wait`)
//! para que todas las sesiones abiertas a ese servidor esperen a que vuelva y reconecten solas.
//!
//! - Siempre es peligroso (sin «Permitir siempre»); en «Solo lo marcado» requiere «Comandos libres».
//! - Usa la misma vía de sudo que `run_command` (sin exponer la contraseña a la IA).
//! - Si la orden falla o se cancela antes de enviarse, desarma el aviso de reinicio (`wait_secs = 0`).

use std::time::Duration;

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::super::backend::Backend;
use super::super::policy::Action;
use super::super::sudo;
use super::elevation::{no_sudo_msg, raw_sudo_hint, NoPassword, SudoAnswer, SudoPurpose, SUDO_CANCELED_MSG};
use super::{Fail, McpCore, Rec, Res};
use crate::ssh::reboot_wait::MAX_WAIT_SECS;

/// Espera por defecto y mínima para que el servidor vuelva tras reiniciar (s).
pub const DEFAULT_REBOOT_WAIT_SECS: u32 = 300;
const MIN_REBOOT_WAIT_SECS: u32 = 30;
/// Tiempo máximo para que el servidor acepte la orden de reinicio (s).
const SEND_TIMEOUT_SECS: u32 = 60;
const MAX_REASON_CHARS: usize = 300;

/// Mismo comando que «Reiniciar ahora» en la interfaz (`src/features/reboot/commands.ts`):
/// lanza el reinicio en segundo plano con 1 s de margen y responde `@@sent` enseguida.
const REBOOT_INNER: &str = "PATH=$PATH:/usr/sbin:/sbin; \
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then c=\"systemctl reboot\"; \
elif command -v shutdown >/dev/null 2>&1; then c=\"shutdown -r now\"; else c=reboot; fi; \
nohup sh -c \"sleep 1; $c\" >/dev/null 2>&1 </dev/null & echo @@sent";

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RebootServerParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Segundos máximos que SSHorus esperará a que vuelva el servidor (30-900, por defecto 300).
    #[serde(default)]
    pub wait_secs: Option<u32>,
    /// Motivo breve del reinicio (se muestra al usuario en el diálogo de permiso).
    #[serde(default)]
    pub reason: Option<String>,
}

fn reboot_command(use_sudo: bool) -> String {
    if use_sudo {
        format!("sudo sh -c '{REBOOT_INNER}'")
    } else {
        format!("sh -c '{REBOOT_INNER}'")
    }
}

fn reboot_sent(stdout: &str) -> bool {
    stdout.lines().any(|l| l.trim() == "@@sent")
}

fn clean_reason(raw: Option<&str>) -> Option<String> {
    let text = raw?.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    Some(match text.char_indices().nth(MAX_REASON_CHARS) {
        Some((i, _)) => format!("{}…", &text[..i]),
        None => text,
    })
}

impl<B: Backend> McpCore<B> {
    pub(super) async fn reboot_server(&self, p: RebootServerParams, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        let wait_secs = p.wait_secs.unwrap_or(DEFAULT_REBOOT_WAIT_SECS).clamp(MIN_REBOOT_WAIT_SECS, MAX_WAIT_SECS);
        let reason = clean_reason(p.reason.as_deref());
        rec.entry.detail = match &reason {
            Some(r) => format!("reiniciar servidor (espera {wait_secs} s): {r}"),
            None => format!("reiniciar servidor (espera {wait_secs} s)"),
        };
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();

        let shown = match &reason {
            Some(r) => format!("Motivo: {r}\nEsperará hasta {wait_secs} s y reconectará automáticamente.\n\n{}", reboot_command(true)),
            None => format!("Esperará hasta {wait_secs} s y reconectará automáticamente.\n\n{}", reboot_command(true)),
        };
        let action = Action::change("reboot_server").with_danger(vec![
            "reinicia el servidor y corta todas las conexiones activas".into(),
            "usa sudo (permisos de administrador)".into(),
        ]);
        self.authorize(rec, &t, action, "quiere reiniciar el servidor", &shown, None).await?;

        let elev = self.ask_sudo(rec, &t, &sid, SudoPurpose::Command).await?;
        let (cmd, password, why) = match elev {
            SudoAnswer::Canceled => return Err(Fail::Denied(SUDO_CANCELED_MSG.into())),
            SudoAnswer::NotNeeded(NoPassword::NoSudo) => {
                return Err(Fail::Error(no_sudo_msg(&t.server.name, &t.server.username)));
            }
            SudoAnswer::NotNeeded(NoPassword::Root) => (reboot_command(false), None, Some(NoPassword::Root)),
            SudoAnswer::NotNeeded(NoPassword::NoPasswd) => (reboot_command(true), None, Some(NoPassword::NoPasswd)),
            SudoAnswer::Password(pw) => (reboot_command(true), Some(pw), None),
        };

        let armed = self.backend.expect_reboot(&sid, wait_secs).await?;

        let run_res = match &password {
            Some(pw) => {
                let wrapped = match sudo::wrap(&cmd, pw) {
                    Ok(w) => w,
                    Err(e) => {
                        let _ = self.backend.expect_reboot(&sid, 0).await;
                        return Err(Fail::Error(e));
                    }
                };
                let r = self.exec_raw(rec, &sid, &wrapped.command, Some(&wrapped.stdin), SEND_TIMEOUT_SECS, cancel).await;
                drop(wrapped);
                r
            }
            None => self.exec_raw(rec, &sid, &cmd, None, SEND_TIMEOUT_SECS, cancel).await,
        };

        let mut r = match run_res {
            Ok(r) => r,
            Err(e) => {
                let _ = self.backend.expect_reboot(&sid, 0).await;
                return Err(e);
            }
        };

        if let Some(pw) = &password {
            sudo::redact(&mut r.stdout, pw);
            sudo::redact(&mut r.stderr, pw);
            if let Some(f) = sudo::failure(r.exit_code, &r.stderr) {
                let _ = self.backend.expect_reboot(&sid, 0).await;
                if f == sudo::SudoFailure::BadPassword {
                    let payload = json!({ "sessionId": sid, "serverName": t.server.name });
                    if let Err(e) = self.backend.ui_request("sudo-rejected", payload, Duration::from_secs(10)).await {
                        log::warn!("MCP: no se pudo avisar a la interfaz de la contraseña de sudo rechazada: {e}");
                    }
                }
                return Err(Fail::Error(sudo::failure_message(f, &t.server.name)));
            }
        }

        if !reboot_sent(&r.stdout) {
            let _ = self.backend.expect_reboot(&sid, 0).await;
            let mut msg = format!("«{}» no confirmó la orden de reinicio.", t.server.name);
            let err = r.stderr.trim();
            if !err.is_empty() {
                msg.push('\n');
                msg.push_str(err);
            }
            if let Some(hint) = why.and_then(|w| raw_sudo_hint(w, &r, &t.server.name)) {
                msg.push_str("\n\n");
                msg.push_str(&hint);
            }
            return Err(Fail::Error(msg));
        }

        let sessions_note = match armed {
            0 => "sin sesiones avisadas".to_string(),
            1 => "1 conexión avisada".to_string(),
            n => format!("{n} conexiones avisadas"),
        };
        rec.entry.message = Some(format!("reinicio enviado ({sessions_note}, espera {wait_secs} s)"));
        Ok(format!(
            "Orden de reinicio enviada a «{}» ({sessions_note}). SSHorus esperará hasta {wait_secs} s y reconectará \
             automáticamente en cuanto el servidor vuelva a responder. Espera unos segundos antes de ejecutar nuevos \
             comandos (puedes comprobar la reconexión con list_sessions).",
            t.server.name
        ))
    }
}
