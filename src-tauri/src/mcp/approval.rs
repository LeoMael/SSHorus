//! Aprobaciones: el asistente quiere cambiar algo y SSHorus te lo pregunta.
//!
//! El motor emite `mcp://approval` con la petición; la interfaz muestra el diálogo y responde con
//! `mcp_approval_reply`. Si nadie responde en el tiempo límite, se deniega (y se emite
//! `mcp://approval-done` para cerrar el diálogo).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

/// Lo que ve la interfaz en el diálogo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub server_id: String,
    pub server_name: String,
    /// Herramienta MCP (`run_command`, `write_file`…).
    pub tool: String,
    /// Frase corta: «quiere ejecutar un comando».
    pub title: String,
    /// Comando exacto, ruta o lista de archivos.
    pub command: String,
    /// Diferencias (solo `write_file`).
    pub diff: Option<String>,
    /// Motivos de peligro (vacío = no es peligroso).
    pub danger: Vec<String>,
    /// Se ofrece «Permitir siempre este comando en este servidor».
    pub can_remember: bool,
    pub timeout_secs: u32,
    /// Unix ms en que se deniega solo.
    pub expires_at: u64,
    pub client: Option<String>,
}

/// Respuesta del usuario.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    /// Permitir una vez.
    Once,
    /// Permitir siempre esta acción en este servidor.
    Always,
    Deny,
}

/// Algo que espera la respuesta del usuario en un diálogo (permiso, emparejado…).
pub trait Pendable: Clone {
    fn id(&self) -> &str;
    /// Unix ms en que vence (ordena la cola: la más antigua primero).
    fn expires_at(&self) -> u64;
}

impl Pendable for ApprovalRequest {
    fn id(&self) -> &str {
        &self.id
    }
    fn expires_at(&self) -> u64 {
        self.expires_at
    }
}

/// Peticiones esperando respuesta: la interfaz las lista y responde por id.
pub struct Pending<R, D> {
    map: Mutex<HashMap<String, (R, oneshot::Sender<D>)>>,
}

/// Permisos del asistente esperando tu respuesta.
pub type PendingApprovals = Pending<ApprovalRequest, Decision>;

type Entries<R, D> = HashMap<String, (R, oneshot::Sender<D>)>;

impl<R, D> Default for Pending<R, D> {
    fn default() -> Self {
        Pending { map: Mutex::new(HashMap::new()) }
    }
}

impl<R: Pendable, D> Pending<R, D> {
    fn lock(&self) -> std::sync::MutexGuard<'_, Entries<R, D>> {
        self.map.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn add(&self, req: R) -> oneshot::Receiver<D> {
        let (tx, rx) = oneshot::channel();
        self.lock().insert(req.id().to_string(), (req, tx));
        rx
    }

    /// Responde. false si ya no estaba pendiente (respondida o vencida).
    pub fn reply(&self, id: &str, decision: D) -> bool {
        let entry = self.lock().remove(id);
        match entry {
            Some((_, tx)) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn remove(&self, id: &str) {
        self.lock().remove(id);
    }

    /// Pendientes, de la más antigua a la más nueva.
    pub fn list(&self) -> Vec<R> {
        let mut v: Vec<R> = self.lock().values().map(|(r, _)| r.clone()).collect();
        v.sort_by_key(Pendable::expires_at);
        v
    }

    /// Responde `answer` a todo lo pendiente (al bloquear SSHorus o apagar el MCP). Devuelve los ids.
    pub fn answer_all(&self, answer: impl Fn() -> D) -> Vec<String> {
        let all: Vec<(String, (R, oneshot::Sender<D>))> = self.lock().drain().collect();
        all.into_iter()
            .map(|(id, (_, tx))| {
                let _ = tx.send(answer());
                id
            })
            .collect()
    }
}

impl PendingApprovals {
    /// Deniega todo lo pendiente.
    pub fn deny_all(&self) -> Vec<String> {
        self.answer_all(|| Decision::Deny)
    }
}
