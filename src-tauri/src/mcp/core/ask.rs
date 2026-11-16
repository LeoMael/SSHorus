//! Esperar al usuario: el diálogo de permiso (con su tiempo límite) y cualquier espera que deba cortarse
//! en cuanto SSHorus se bloquea.
//!
//! El bloqueo se vigila mientras se espera, no solo al final: si se bloqueara y desbloqueara durante la
//! espera, una comprobación al final no lo vería y se haría algo que el usuario permitió (o escribió) con la
//! app a punto de bloquearse.

use std::future::Future;
use std::time::Duration;

use super::super::approval::{ApprovalRequest, Decision};
use super::super::audit::now_ms;
use super::super::backend::Backend;
use super::{Fail, McpCore, Rec, Res, Target};

/// Cada cuánto se mira si SSHorus se bloqueó mientras se espera.
const LOCK_POLL: Duration = Duration::from_millis(200);

/// Lo que muestra el diálogo de permiso.
pub(super) struct Ask<'a> {
    /// Frase corta: «quiere ejecutar un comando».
    pub title: &'a str,
    /// Comando exacto, ruta o motivo.
    pub shown: &'a str,
    pub diff: Option<String>,
    /// Motivos de peligro o avisos (vacío = nada que avisar).
    pub danger: Vec<String>,
    /// Se ofrece «Permitir siempre».
    pub can_remember: bool,
}

impl<B: Backend> McpCore<B> {
    /// Espera `fut`, pero si SSHorus se bloquea antes (o lo está al terminar) devuelve `Fail::Locked`.
    pub(super) async fn unless_locked<T>(&self, fut: impl Future<Output = T>) -> Res<T> {
        let watch = async {
            while !self.backend.vault_locked() {
                tokio::time::sleep(LOCK_POLL).await;
            }
        };
        tokio::select! {
            biased;
            v = fut => if self.backend.vault_locked() { Err(Fail::Locked) } else { Ok(v) },
            () = watch => Err(Fail::Locked),
        }
    }

    /// Muestra el diálogo de permiso y espera la respuesta. Sin respuesta en el tiempo de Ajustes se
    /// deniega; con SSHorus bloqueado mientras tanto, nada (aunque se hubiera permitido).
    pub(super) async fn ask_user(&self, rec: &mut Rec, t: &Target, ask: Ask<'_>) -> Res<Decision> {
        let secs = self.config.get().approval_timeout_secs;
        let req = ApprovalRequest {
            id: uuid::Uuid::new_v4().to_string(),
            server_id: t.server.id.clone(),
            server_name: t.server.name.clone(),
            tool: rec.entry.tool.clone(),
            title: ask.title.to_string(),
            command: ask.shown.to_string(),
            diff: ask.diff,
            danger: ask.danger,
            can_remember: ask.can_remember,
            timeout_secs: secs,
            expires_at: now_ms() + u64::from(secs) * 1000,
            client: rec.entry.client.clone(),
        };
        let id = req.id.clone();
        rec.entry.message = Some("Esperando tu permiso en SSHorus".into());
        self.audit.record(rec.entry.clone());
        let wait = tokio::time::timeout(Duration::from_secs(u64::from(secs)), self.backend.ask_approval(req));
        let answer = self.unless_locked(wait).await;
        self.backend.approval_done(&id);
        rec.entry.message = None;
        match answer? {
            Ok(d) => Ok(d),
            Err(_) => {
                rec.entry.approved_by = Some("sin respuesta".into());
                Err(Fail::Denied(format!(
                    "Nadie respondió en SSHorus en {secs} s: se denegó. Pide al usuario que mire SSHorus y vuelve a intentarlo."
                )))
            }
        }
    }
}
