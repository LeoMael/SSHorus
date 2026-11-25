//! Avisar a la interfaz: hay una petición de emparejado, ya no la hay o cambió la lista de asistentes.
//! En la app son eventos de Tauri; en las pruebas, un canal.

use tauri::{AppHandle, Emitter};

use super::model::{ClientView, PairPrompt};

/// Payload: `PairPrompt`. Un asistente pide emparejarse (abre el diálogo).
pub const EV_PAIR_REQUEST: &str = "mcp://pair-request";
/// Payload: id. La petición ya no está pendiente (respondida, vencida o SSHorus bloqueado).
pub const EV_PAIR_DONE: &str = "mcp://pair-done";
/// Payload: `Vec<ClientView>`. Cambió la lista de asistentes emparejados.
pub const EV_PAIRED: &str = "mcp://paired";

pub trait PairNotifier: Send + Sync + 'static {
    fn show(&self, prompt: &PairPrompt);
    fn done(&self, id: &str);
    fn changed(&self, clients: &[ClientView]);
}

/// En la app: eventos a la ventana, y la ventana al frente para que veas la petición.
pub struct TauriNotifier(pub AppHandle);

impl PairNotifier for TauriNotifier {
    fn show(&self, prompt: &PairPrompt) {
        if let Err(e) = self.0.emit(EV_PAIR_REQUEST, prompt) {
            log::warn!("MCP: no se pudo mostrar la petición de emparejado: {e}");
        }
        super::super::backend::bring_to_front(&self.0);
    }

    fn done(&self, id: &str) {
        let _ = self.0.emit(EV_PAIR_DONE, id);
    }

    fn changed(&self, clients: &[ClientView]) {
        let _ = self.0.emit(EV_PAIRED, clients);
    }
}
