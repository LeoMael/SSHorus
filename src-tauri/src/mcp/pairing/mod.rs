//! Emparejar asistentes de IA con «Aceptar / Rechazar», sin copiar secretos.
//!
//! La IA ejecuta `sshorus-mcp pair`; el puente pide `POST /pair` (`route`); aquí se muestra el diálogo, se
//! espera tu respuesta (hasta 2 min) y, si aceptas, se crea un token SOLO para ese asistente con los
//! permisos por servidor que elegiste. Varios asistentes a la vez, cada uno con lo suyo, y cada uno se
//! revoca por separado. El token general (configuración copiada a mano) sigue valiendo.
//!
//! Partes: `token` (crear y comprobar tokens, puro), `limiter` (límite de peticiones, puro), `model`
//! (datos), `registry` (lista guardada y comprobación del token), `journal` (registro de actividad),
//! `notify` (avisos a la interfaz), `route` (HTTP) y `commands` (comandos Tauri).

pub mod commands;
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
use super::caller::ClientGrant;
use super::core::LOCKED_MSG;
use super::policy::Access;
use crate::error::AppResult;
use limiter::RateLimiter;
use model::{ClientView, PairDecision, PairPrompt, PairedClient};
use notify::PairNotifier;
use registry::{ClientRegistry, TokenCheck};

/// Lo que la petición necesita saber de la app en ese momento.
pub struct PairContext<'a> {
    pub audit: &'a AuditLog,
    /// Servidores guardados: id → nombre.
    pub servers: BTreeMap<String, String>,
    /// SSHorus se bloqueó (se mira al recibir la respuesta).
    pub locked: &'a (dyn Fn() -> bool + Sync),
}

/// Quién es el dueño de un token `tvc_…`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Auth {
    Client(ClientGrant),
    /// Era de un asistente revocado: el mensaje lo explica.
    Revoked(String),
    Unknown,
}

pub struct Pairing {
    registry: ClientRegistry,
    pending: Pending<PairPrompt, PairDecision>,
    limiter: Mutex<RateLimiter>,
    notifier: Box<dyn PairNotifier>,
    wait: Duration,
}

/// Libera el hueco del limitador al terminar la petición, pase lo que pase.
struct Slot<'a> {
    limiter: &'a Mutex<RateLimiter>,
    client_id: String,
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        lock(self.limiter).finish(&self.client_id);
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Lo que llega del puente, recortado y con un id válido.
fn clean_request(mut req: PairRequest) -> Option<PairRequest> {
    req.client_id = wire::clean_client_id(&req.client_id)?;
    let clip = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
    req.name = clip(&req.name, 60);
    if req.name.is_empty() {
        req.name = req.client_id.clone();
    }
    req.program = clip(&req.program, 200);
    req.cwd = req.cwd.map(|c| clip(&c, 300)).filter(|c| !c.is_empty());
    Some(req)
}

/// Permisos con nombre de servidor (los que ya no existen no se muestran).
pub fn grants(access: &BTreeMap<String, Access>, servers: &BTreeMap<String, String>) -> Vec<ServerGrant> {
    access
        .iter()
        .filter_map(|(id, a)| servers.get(id).map(|name| ServerGrant { name: name.clone(), access: a.label().into() }))
        .collect()
}

fn grants_text(list: &[ServerGrant]) -> String {
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

    /// Atiende una petición de emparejado de principio a fin.
    pub async fn request(&self, req: PairRequest, ctx: &PairContext<'_>) -> PairReply {
        let Some(req) = clean_request(req) else {
            return PairReply::new(PairOutcome::Invalid, "Petición de emparejado no válida.");
        };
        if let Err(limit) = lock(&self.limiter).begin(&req.client_id, now_ms()) {
            log::info!("MCP: emparejado de {} rechazado por el límite: {limit:?}", req.client_id);
            return PairReply::new(PairOutcome::Busy, limit.message());
        }
        let _slot = Slot { limiter: &self.limiter, client_id: req.client_id.clone() };
        let record = journal::PairRecord::start(ctx.audit, &req);
        let decision = self.ask(&req).await;
        if (ctx.locked)() {
            record.finish(AuditStatus::Locked, "SSHorus bloqueado", LOCKED_MSG.into());
            return PairReply::new(PairOutcome::Locked, LOCKED_MSG);
        }
        let d = match decision {
            None => {
                record.finish(AuditStatus::Denied, "sin respuesta", "Nadie respondió a tiempo.".into());
                return PairReply::new(
                    PairOutcome::Timeout,
                    "Nadie respondió en SSHorus a tiempo. Vuelve a intentarlo cuando el usuario esté delante.",
                );
            }
            Some(d) if !d.accept => {
                record.finish(AuditStatus::Denied, "tú: rechazado", "Rechazado.".into());
                return PairReply::new(PairOutcome::Rejected, "El usuario rechazó el emparejado en SSHorus.");
            }
            Some(d) => d,
        };
        match self.issue(&req, d.access) {
            Ok((token, client)) => {
                let servers = grants(&client.access, &ctx.servers);
                record.finish(AuditStatus::Ok, "tú: aceptado", format!("Permisos: {}.", grants_text(&servers)));
                self.notifier.changed(&self.clients());
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

    /// Muestra el diálogo y espera tu respuesta (None = no hubo a tiempo).
    async fn ask(&self, req: &PairRequest) -> Option<PairDecision> {
        let existing = self.registry.get(&req.client_id);
        let prompt = PairPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            client_id: req.client_id.clone(),
            name: req.name.clone(),
            program: req.program.clone(),
            pid: req.pid,
            cwd: req.cwd.clone(),
            replaces: existing.is_some(),
            current: existing.map(|c| c.access).unwrap_or_default(),
            timeout_secs: self.wait.as_secs(),
            expires_at: now_ms() + self.wait.as_millis() as u64,
        };
        let rx = self.pending.add(prompt.clone());
        self.notifier.show(&prompt);
        let answer = tokio::time::timeout(self.wait, rx).await;
        self.pending.remove(&prompt.id);
        self.notifier.done(&prompt.id);
        match answer {
            Ok(Ok(d)) => Some(d),
            // Se cerró sin respuesta (SSHorus se bloqueó o se apagó el MCP): rechazado.
            Ok(Err(_)) => Some(PairDecision::reject()),
            Err(_) => None,
        }
    }

    fn issue(&self, req: &PairRequest, access: BTreeMap<String, Access>) -> AppResult<(Zeroizing<String>, PairedClient)> {
        let kid = token::new_kid()?;
        let issued = token::issue(&kid)?;
        let now = now_ms();
        let client = PairedClient {
            id: req.client_id.clone(),
            name: req.name.clone(),
            program: req.program.clone(),
            pid: req.pid,
            cwd: req.cwd.clone(),
            created_at: now,
            last_used: None,
            access: model::clean_access(access),
            kid,
            token: issued.hash,
        };
        self.registry.insert(client.clone(), now)?;
        Ok((issued.token, client))
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

    /// Dueño de un token de asistente. Los intentos con uno revocado quedan en el registro.
    pub fn authenticate(&self, tok: &str, audit: &AuditLog) -> Auth {
        let now = now_ms();
        match self.registry.check(tok, now) {
            TokenCheck::Valid(c) => Auth::Client(ClientGrant { id: c.id, name: c.name, access: c.access }),
            TokenCheck::Revoked(r) => {
                if self.registry.should_log_failure(&r.kid, now) {
                    journal::revoked_token_used(audit, &r.id, &r.name);
                }
                Auth::Revoked(format!(
                    "Este asistente ({}) ya no está emparejado con SSHorus: se revocó o se volvió a emparejar. \
                     Ejecuta «sshorus-mcp pair» para emparejarlo de nuevo.",
                    r.name
                ))
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

    /// «Revocar»: su token deja de valer al instante.
    pub fn revoke(&self, id: &str, audit: &AuditLog) -> AppResult<Vec<ClientView>> {
        let c = self.registry.revoke(id, now_ms())?;
        journal::revoked(audit, &c);
        Ok(self.notify_changed())
    }

    fn notify_changed(&self) -> Vec<ClientView> {
        let list = self.clients();
        self.notifier.changed(&list);
        list
    }
}
