//! El paso común a los dos caminos de emparejado: límite de peticiones, diálogo «Aceptar / Rechazar»,
//! espera (hasta 2 min) y registro. El puente (`POST /pair`) y OAuth (`/authorize`) solo cambian lo que
//! hacen después de que aceptes: el primero entrega un token; el segundo, un código de autorización.

use std::collections::BTreeMap;

use super::super::audit::{now_ms, AuditStatus};
use super::super::bridge::wire::{PairOutcome, PairReply};
use super::super::core::LOCKED_MSG;
use super::super::policy::Access;
use super::applicant::Applicant;
use super::journal::PairRecord;
use super::limiter::RateLimiter;
use super::model::{PairDecision, PairPrompt};
use super::{lock, PairContext, Pairing};

/// Cómo terminó el diálogo.
pub enum Consent<'a> {
    /// Aceptaste con estos permisos. La entrada del registro sigue abierta: la cierra quien entrega el acceso.
    Accepted { access: BTreeMap<String, Access>, record: Box<PairRecord<'a>> },
    /// No se emparejó (rechazado, sin respuesta, bloqueado o demasiadas peticiones): ya está anotado.
    Refused(PairReply),
}

/// Libera el hueco del limitador al terminar la petición, pase lo que pase.
struct Slot<'a> {
    limiter: &'a std::sync::Mutex<RateLimiter>,
    client_id: String,
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        lock(self.limiter).finish(&self.client_id);
    }
}

/// Si la petición se abandona (el cliente cierra la conexión), el diálogo se cierra igual.
struct Shown<'a> {
    pairing: &'a Pairing,
    id: String,
}

impl Drop for Shown<'_> {
    fn drop(&mut self) {
        self.pairing.pending.remove(&self.id);
        self.pairing.notifier.done(&self.id);
    }
}

impl Pairing {
    /// Pregunta si aceptas a `a`, con el límite de peticiones y el registro.
    pub async fn consent<'a>(&self, a: &Applicant, ctx: &PairContext<'a>) -> Consent<'a> {
        if let Err(limit) = lock(&self.limiter).begin(&a.client_id, now_ms()) {
            log::info!("MCP: emparejado de {} rechazado por el límite: {limit:?}", a.client_id);
            return Consent::Refused(PairReply::new(PairOutcome::Busy, limit.message()));
        }
        let _slot = Slot { limiter: &self.limiter, client_id: a.client_id.clone() };
        let record = PairRecord::start(ctx.audit, a);
        let decision = self.ask(a).await;
        if (ctx.locked)() {
            record.finish(AuditStatus::Locked, "SSHorus bloqueado", LOCKED_MSG.into());
            return Consent::Refused(PairReply::new(PairOutcome::Locked, LOCKED_MSG));
        }
        match decision {
            None => {
                record.finish(AuditStatus::Denied, "sin respuesta", "Nadie respondió a tiempo.".into());
                Consent::Refused(PairReply::new(
                    PairOutcome::Timeout,
                    "Nadie respondió en SSHorus a tiempo. Vuelve a intentarlo cuando el usuario esté delante.",
                ))
            }
            Some(d) if !d.accept => {
                record.finish(AuditStatus::Denied, "tú: rechazado", "Rechazado.".into());
                Consent::Refused(PairReply::new(PairOutcome::Rejected, "El usuario rechazó el emparejado en SSHorus."))
            }
            Some(d) => Consent::Accepted { access: d.access, record: Box::new(record) },
        }
    }

    /// Muestra el diálogo y espera tu respuesta (None = no hubo a tiempo).
    async fn ask(&self, a: &Applicant) -> Option<PairDecision> {
        let existing = self.registry.get(&a.client_id);
        let prompt = PairPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            client_id: a.client_id.clone(),
            name: a.name.clone(),
            via: a.via,
            facts: a.facts.clone(),
            replaces: existing.is_some(),
            current: existing.map(|c| c.access).unwrap_or_default(),
            timeout_secs: self.wait.as_secs(),
            expires_at: now_ms() + self.wait.as_millis() as u64,
        };
        let rx = self.pending.add(prompt.clone());
        self.notifier.show(&prompt);
        let _shown = Shown { pairing: self, id: prompt.id.clone() };
        match tokio::time::timeout(self.wait, rx).await {
            Ok(Ok(d)) => Some(d),
            // Se cerró sin respuesta (SSHorus se bloqueó o se apagó el MCP): rechazado.
            Ok(Err(_)) => Some(PairDecision::reject()),
            Err(_) => None,
        }
    }
}
