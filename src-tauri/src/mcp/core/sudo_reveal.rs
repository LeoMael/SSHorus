//! `request_sudo_password`: la IA pide la contraseña de sudo de un servidor y SSHorus se la da EN TEXTO.
//!
//! Lo normal es no necesitarla: `run_command` con sudo la usa sin enseñarla (elevation.rs). Esta
//! herramienta es para cuando de verdad hace falta verla, y por eso:
//! - Pregunta SIEMPRE con un diálogo propio (servidor, motivo de la IA y el aviso de que quedará en la
//!   conversación). Sin «Permitir siempre» y sin pasar por las reglas: «Aceptar automáticamente» no la salta.
//! - Solo con acceso Completo y con el ajuste «La IA puede pedir la contraseña de sudo» encendido.
//! - Sin respuesta a tiempo se deniega; con SSHorus bloqueado, nada.
//! - Se anota en el registro (motivo y resultado), nunca la contraseña.

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

use super::super::approval::Decision;
use super::super::backend::Backend;
use super::super::policy::Access;
use super::ask::Ask;
use super::elevation::{no_sudo_msg, NoPassword, SudoAnswer, SudoPurpose};
use super::{Fail, McpCore, Rec, Res};

/// Aviso del diálogo (también lo ve la interfaz como motivo de peligro).
pub const REVEAL_WARNING: &str = "La contraseña quedará en la conversación con la IA";
/// Largo máximo del motivo que se muestra y se anota.
const MAX_REASON_CHARS: usize = 500;

pub const REVEAL_DISABLED_MSG: &str = "El usuario no permite que la IA pida la contraseña de sudo (SSHorus → \
Ajustes → Asistentes de IA). Usa run_command con «sudo …»: SSHorus pone la contraseña sin que la veas.";
pub const REVEAL_DENIED_MSG: &str = "El usuario no quiso darte la contraseña de sudo. Usa run_command con \
«sudo …»: SSHorus pone la contraseña sin que la veas.";
pub const REVEAL_CANCELED_MSG: &str = "El usuario no escribió la contraseña de sudo en SSHorus (cerró el \
diálogo o no respondió a tiempo). Usa run_command con «sudo …» o vuelve a pedirla si de verdad hace falta.";

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SudoPasswordParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Para qué necesitas ver la contraseña (el usuario lo lee tal cual en SSHorus). Sé concreto.
    pub reason: String,
}

pub fn read_only_msg(server: &str) -> String {
    format!(
        "Solo se puede pedir la contraseña de sudo en servidores con acceso Completo, y «{server}» es de solo \
         lectura para el asistente. El usuario puede cambiarlo en SSHorus → Ajustes → Asistentes de IA (MCP)."
    )
}

/// Motivo limpio: sin espacios de sobra y como mucho `MAX_REASON_CHARS` caracteres.
fn clean_reason(s: &str) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    match one_line.char_indices().nth(MAX_REASON_CHARS) {
        Some((i, _)) => format!("{}…", &one_line[..i]),
        None => one_line,
    }
}

impl<B: Backend> McpCore<B> {
    pub(super) async fn request_sudo_password(&self, p: SudoPasswordParams, rec: &mut Rec) -> Res<String> {
        let reason = clean_reason(&p.reason);
        rec.entry.detail = format!("motivo: {reason}");
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        if !self.config.get().allow_sudo_password_request {
            return Err(Fail::Denied(REVEAL_DISABLED_MSG.into()));
        }
        if t.access != Access::Full {
            return Err(Fail::Denied(read_only_msg(&t.server.name)));
        }
        if reason.is_empty() {
            return Err(Fail::Error("Falta el motivo (reason): explica al usuario para qué necesitas la contraseña.".into()));
        }
        let sid = t.session_id()?.to_string();
        let ask = Ask {
            title: "pide la contraseña de sudo",
            shown: &reason,
            diff: None,
            danger: vec![REVEAL_WARNING.into()],
            can_remember: false,
        };
        if self.ask_user(rec, &t, ask).await? == Decision::Deny {
            rec.entry.approved_by = Some("tú: denegado".into());
            return Err(Fail::Denied(REVEAL_DENIED_MSG.into()));
        }
        rec.entry.approved_by = Some("tú: una vez".into());
        let (name, user) = (&t.server.name, &t.server.username);
        match self.ask_sudo(rec, &t, &sid, SudoPurpose::Reveal(&reason)).await? {
            SudoAnswer::Password(pw) => {
                rec.entry.message = Some("contraseña entregada a la IA".into());
                Ok(format!(
                    "Contraseña de sudo de «{user}» en «{name}» (comprobada con sudo):\n{}\n\n\
                     No la repitas ni la guardes en archivos, y no la pongas en la línea de comandos (se vería en \
                     `ps` y en el historial). Para comandos con sudo usa run_command: SSHorus la pone sin que la veas.",
                    pw.as_str()
                ))
            }
            SudoAnswer::NotNeeded(NoPassword::Root) => {
                rec.entry.message = Some("no hace falta (root)".into());
                Ok(format!("No hace falta contraseña: en «{name}» estás conectado como root. Usa run_command sin sudo."))
            }
            SudoAnswer::NotNeeded(NoPassword::NoPasswd) => {
                rec.entry.message = Some("no hace falta (sudo sin contraseña)".into());
                Ok(format!("sudo no pide contraseña a «{user}» en «{name}»: usa run_command con «sudo …» directamente."))
            }
            SudoAnswer::NotNeeded(NoPassword::NoSudo) => Err(Fail::Error(no_sudo_msg(name, user))),
            SudoAnswer::Canceled => Err(Fail::Denied(REVEAL_CANCELED_MSG.into())),
        }
    }
}
