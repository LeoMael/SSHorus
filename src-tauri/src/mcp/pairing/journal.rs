//! Lo que el emparejado deja en el registro del asistente (`mcp-audit.jsonl` y el panel de actividad):
//! cada petición con su resultado, cada cambio de permisos, cada revocación, los intentos con un token
//! revocado y, por OAuth, el canje del código y los intentos fallidos. Nunca un token.

use super::super::audit::{AuditEntry, AuditLog, AuditStatus};
use super::applicant::Applicant;
use super::model::PairedClient;

pub const TOOL_PAIR: &str = "emparejar";
pub const TOOL_PERMS: &str = "emparejar: permisos";
pub const TOOL_REVOKE: &str = "emparejar: revocar";
pub const TOOL_AUTH: &str = "emparejar: token revocado";
pub const TOOL_OAUTH: &str = "emparejar: OAuth";

fn entry(tool: &str, client_id: &str, name: &str) -> AuditEntry {
    let mut e = AuditEntry::start(tool);
    e.client = Some(name.to_string());
    e.client_id = Some(client_id.to_string());
    e
}

/// Una petición de emparejado: se anota «en marcha» y se completa con `finish`.
pub struct PairRecord<'a> {
    log: &'a AuditLog,
    entry: AuditEntry,
}

impl<'a> PairRecord<'a> {
    pub fn start(log: &'a AuditLog, a: &Applicant) -> Self {
        let mut e = entry(TOOL_PAIR, &a.client_id, &a.name);
        e.detail = a.detail();
        e.message = Some("Esperando tu respuesta en SSHorus".into());
        log.record(e.clone());
        PairRecord { log, entry: e }
    }

    /// Termina la entrada (se escribe en el archivo).
    pub fn finish(mut self, status: AuditStatus, approved_by: &str, message: String) {
        self.entry.status = status;
        self.entry.approved_by = Some(approved_by.to_string());
        self.entry.message = Some(message);
        self.entry.duration_ms = Some(super::super::audit::now_ms().saturating_sub(self.entry.at));
        self.log.record(self.entry);
    }
}

fn done(log: &AuditLog, mut e: AuditEntry, detail: String) {
    e.detail = detail;
    e.status = AuditStatus::Ok;
    e.approved_by = Some("tú".into());
    log.record(e);
}

pub fn permissions_changed(log: &AuditLog, c: &PairedClient, summary: String) {
    done(log, entry(TOOL_PERMS, &c.id, &c.name), summary);
}

pub fn revoked(log: &AuditLog, c: &PairedClient) {
    done(log, entry(TOOL_REVOKE, &c.id, &c.name), "Sus tokens dejaron de valer.".into());
}

pub fn revoked_token_used(log: &AuditLog, client_id: &str, name: &str) {
    let mut e = entry(TOOL_AUTH, client_id, name);
    e.detail = "Intentó usar SSHorus con un token revocado.".into();
    e.status = AuditStatus::Denied;
    log.record(e);
}

/// Un paso de OAuth fuera del diálogo (canje del código, renovación rechazada, revocación desde el cliente).
pub fn oauth(log: &AuditLog, client_id: &str, name: &str, ok: bool, detail: impl Into<String>) {
    let mut e = entry(TOOL_OAUTH, client_id, name);
    e.detail = detail.into();
    e.status = if ok { AuditStatus::Ok } else { AuditStatus::Denied };
    log.record(e);
}
