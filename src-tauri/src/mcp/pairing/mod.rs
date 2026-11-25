//! Emparejar asistentes de IA con «Aceptar / Rechazar», sin copiar secretos.
//!
//! Dos caminos, un mismo diálogo y una misma lista de asistentes:
//! - Puente: la IA ejecuta `sshorus-mcp pair`; el puente pide `POST /pair` (`route`) y, si aceptas, recibe
//!   un token SOLO para ese asistente.
//! - HTTP directo: el cliente sigue la autorización estándar de MCP (OAuth, `mcp::oauth`), abre tu navegador
//!   y, si aceptas, recibe tokens de acceso que caducan y se renuevan.
//!
//! Cada asistente tiene sus propios permisos por servidor y se revoca por separado. El token general
//! (configuración copiada a mano) sigue valiendo.
//!
//! Partes: `token` (crear y comprobar tokens, puro), `limiter` (límite de peticiones, puro), `model`
//! (datos), `applicant` (quién lo pide), `consent` (el diálogo y su espera), `registry` (lista guardada y
//! comprobación de tokens), `journal` (registro de actividad), `notify` (avisos a la interfaz), `route`
//! (HTTP del puente) y `commands` (comandos Tauri).

pub mod applicant;
pub mod commands;
pub mod consent;
mod journal;
pub mod limiter;
pub mod model;
pub mod notify;
pub mod registry;
pub mod route;
pub mod token;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use zeroize::Zeroizing;

use super::approval::Pending;
use super::audit::{now_ms, AuditLog, AuditStatus};
use super::bridge::wire::{self, PairOutcome, PairReply, PairRequest, ServerGrant};
use super::caller::{ClientGrant, PairedAccess};
use super::policy::Access;
use crate::error::AppResult;
use applicant::Applicant;
use consent::Consent;
pub use journal::oauth as journal_oauth;
use limiter::RateLimiter;
use model::{ClientView, OAuthLink, PairDecision, PairPrompt, PairedClient, Via};
use notify::PairNotifier;
use registry::{ClientRegistry, Revoked, TokenCheck};
use token::Kind;

/// Lo que la petición necesita saber de la app en ese momento.
pub struct PairContext<'a> {
    pub audit: &'a AuditLog,
    /// Servidores guardados: id → nombre.
    pub servers: BTreeMap<String, String>,
    /// SSHorus se bloqueó (se mira al recibir la respuesta).
    pub locked: &'a (dyn Fn() -> bool + Sync),
}

/// Quién es el dueño de un token de asistente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Auth {
    Client(ClientGrant),
    /// Era de un asistente revocado: el mensaje lo explica.
    Revoked(String),
    /// Token de acceso de OAuth caducado (el cliente pide otro con su token de renovación).
    Expired,
    Unknown,
}

pub struct Pairing {
    registry: ClientRegistry,
    pending: Pending<PairPrompt, PairDecision>,
    limiter: Mutex<RateLimiter>,
    notifier: Box<dyn PairNotifier>,
    wait: Duration,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Permisos con nombre de servidor (los que ya no existen no se muestran).
pub fn grants(access: &BTreeMap<String, Access>, servers: &BTreeMap<String, String>) -> Vec<ServerGrant> {
    access
        .iter()
        .filter_map(|(id, a)| servers.get(id).map(|name| ServerGrant { name: name.clone(), access: a.label().into() }))
        .collect()
}

pub fn grants_text(list: &[ServerGrant]) -> String {
    if list.is_empty() {
        return "sin acceso a ningún servidor".into();
    }
    list.iter().map(|g| format!("{}: {}", g.name, g.access)).collect::<Vec<_>>().join(", ")
}

impl Pairing {
    pub fn new(registry: ClientRegistry, notifier: Box<dyn PairNotifier>) -> Self {
        Pairing {
            registry,
            pending: Pending::default(),
            limiter: Mutex::new(RateLimiter::default()),
            notifier,
            wait: Duration::from_secs(wire::PAIR_WAIT_SECS),
        }
    }

    /// Otra espera (pruebas).
    #[cfg(test)]
    pub fn with_wait(mut self, wait: Duration) -> Self {
        self.wait = wait;
        self
    }

    pub fn registry(&self) -> &ClientRegistry {
        &self.registry
    }

    /// Petición del puente (`sshorus-mcp pair`) de principio a fin.
    pub async fn request(&self, req: PairRequest, ctx: &PairContext<'_>) -> PairReply {
        let Some(a) = Applicant::from_bridge(&req) else {
            return PairReply::new(PairOutcome::Invalid, "Petición de emparejado no válida.");
        };
        let (access, record) = match self.consent(&a, ctx).await {
            Consent::Accepted { access, record } => (access, record),
            Consent::Refused(reply) => return reply,
        };
        match self.issue(&a, access, None) {
            Ok((token, client)) => {
                let servers = grants(&client.access, &ctx.servers);
                record.finish(AuditStatus::Ok, "tú: aceptado", format!("Permisos: {}.", grants_text(&servers)));
                PairReply {
                    outcome: PairOutcome::Accepted,
                    message: format!("SSHorus emparejó a «{}». Cada cambio sigue pidiendo permiso en SSHorus.", client.name),
                    token: Some(token.to_string()),
                    servers,
                }
            }
            Err(e) => {
                record.finish(AuditStatus::Error, "tú: aceptado", e.to_string());
                PairReply::new(PairOutcome::Invalid, format!("No se pudo guardar el emparejado: {e}"))
            }
        }
    }

    /// Crea (o reemplaza) la ficha de un asistente aceptado y su token: el del puente o, con `oauth`, el de
    /// renovación. Avisa a la interfaz.
    pub fn issue(
        &self,
        a: &Applicant,
        access: BTreeMap<String, Access>,
        oauth: Option<OAuthLink>,
    ) -> AppResult<(Zeroizing<String>, PairedClient)> {
        let via = if oauth.is_some() { Via::OAuth } else { Via::Bridge };
        let kind = if oauth.is_some() { Kind::Refresh } else { Kind::Bridge };
        let now = now_ms();
        let (client, token) = self.registry.insert_new(now, |kid| {
            let issued = token::issue(kind, kid)?;
            let client = PairedClient {
                id: a.client_id.clone(),
                name: a.name.clone(),
                program: a.program.clone(),
                pid: a.pid,
                cwd: a.cwd.clone(),
                created_at: now,
                last_used: None,
                access: model::clean_access(access),
                kid: kid.to_string(),
                token: issued.hash,
                via,
                oauth,
            };
            Ok((client, issued.token))
        })?;
        self.notify_changed();
        Ok((token, client))
    }

    /// Respuesta del diálogo. false si ya no estaba pendiente.
    pub fn reply(&self, id: &str, decision: PairDecision) -> bool {
        self.pending.reply(id, decision)
    }

    pub fn pending(&self) -> Vec<PairPrompt> {
        self.pending.list()
    }

    /// Rechaza todo lo pendiente (SSHorus se bloqueó o se apagó el MCP).
    pub fn reject_all(&self) {
        for id in self.pending.answer_all(PairDecision::reject) {
            self.notifier.done(&id);
        }
    }

    /// Dueño de un token del puente. Calcula una huella y puede escribir en disco: fuera del hilo async.
    pub fn authenticate(&self, tok: &str, audit: &AuditLog) -> Auth {
        let now = now_ms();
        self.auth_of(self.registry.check(tok, Kind::Bridge, now), audit, now)
    }

    /// `Auth` de una comprobación del registro; los intentos con un token revocado quedan en el registro.
    pub fn auth_of(&self, check: TokenCheck, audit: &AuditLog, now: u64) -> Auth {
        match check {
            TokenCheck::Valid(c) => Auth::Client(ClientGrant { id: c.id, name: c.name, access: c.access }),
            TokenCheck::Revoked(r) => {
                if self.registry.should_log_failure(&r.kid, now) {
                    journal::revoked_token_used(audit, &r.id, &r.name);
                }
                Auth::Revoked(revoked_message(&r))
            }
            TokenCheck::Unknown => Auth::Unknown,
        }
    }

    pub fn clients(&self) -> Vec<ClientView> {
        self.registry.list().iter().map(ClientView::from).collect()
    }

    /// «Cambiar permisos» de un asistente.
    pub fn set_access(
        &self,
        id: &str,
        access: BTreeMap<String, Access>,
        audit: &AuditLog,
        servers: &BTreeMap<String, String>,
    ) -> AppResult<Vec<ClientView>> {
        let c = self.registry.set_access(id, access)?;
        journal::permissions_changed(audit, &c, format!("Permisos: {}.", grants_text(&grants(&c.access, servers))));
        Ok(self.notify_changed())
    }

    /// «Revocar»: sus tokens (del puente, o de acceso y de renovación) dejan de valer al instante.
    pub fn revoke(&self, id: &str, audit: &AuditLog) -> AppResult<Vec<ClientView>> {
        let c = self.registry.revoke(id, now_ms())?;
        journal::revoked(audit, &c);
        Ok(self.notify_changed())
    }

    pub fn notify_changed(&self) -> Vec<ClientView> {
        let list = self.clients();
        self.notifier.changed(&list);
        list
    }
}

fn revoked_message(r: &Revoked) -> String {
    let again = match r.via {
        Via::Bridge => "Ejecuta «sshorus-mcp pair» para emparejarlo de nuevo.",
        Via::OAuth => "Vuelve a conectarlo desde el asistente (te pedirá aceptarlo en SSHorus).",
    };
    format!("Este asistente ({}) ya no está emparejado con SSHorus: se revocó o se volvió a emparejar. {again}", r.name)
}

impl PairedAccess for Pairing {
    fn allows_auto(&self, server_id: &str) -> bool {
        self.registry.list().iter().any(|c| c.access.get(server_id).is_some_and(|a| a.allows_auto()))
    }
}
