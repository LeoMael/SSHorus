//! Tipos compartidos entre el motor y la interfaz.
//!
//! CONTRATO: cada tipo aquí tiene su espejo exacto en `src/api/types.ts`.
//! Si cambias uno, cambia el otro. Todos se serializan en camelCase.
//!
//! Por temas: servidores y proyectos (`profiles`), ajustes (`settings`), sesiones SSH y terminales
//! (`session`), archivos y transferencias (`files`) y biblioteca de comandos (`snippets`). Todo se
//! re-exporta aquí: se usa siempre como `crate::types::X`.

mod files;
mod profiles;
mod session;
mod settings;
mod snippets;

pub use files::*;
pub use profiles::*;
pub use session::*;
pub use settings::*;
pub use snippets::*;

// ───────────────────────── Eventos globales (app.emit) ─────────────────────────

/// Payload: `Vec<TransferJob>` con los trabajos que cambiaron (máx. cada ~200 ms).
pub const EV_TRANSFER_UPDATE: &str = "transfer://update";
/// Payload: `Vec<String>` con ids de trabajos eliminados de la lista.
pub const EV_TRANSFER_REMOVED: &str = "transfer://removed";
/// Payload: `TerminalExit`.
pub const EV_TERMINAL_EXIT: &str = "terminal://exit";
/// Payload: `SessionClosed`. Se emite cuando una conexión SSH se cierra o se cae
/// (si la reconexión automática se rindió o está desactivada).
pub const EV_SESSION_CLOSED: &str = "session://closed";
/// Payload: `SessionReconnecting`. La conexión se cayó y se está reintentando (mismo sessionId).
pub const EV_SESSION_RECONNECTING: &str = "session://reconnecting";
/// Payload: `SessionInfo`. La reconexión funcionó: mismo sessionId, conexión nueva.
/// Terminales y canales SFTP anteriores murieron: hay que reabrirlos.
pub const EV_SESSION_RECONNECTED: &str = "session://reconnected";
/// Payload: `VaultStatus` (storage::vault). La bóveda se bloqueó, desbloqueó, creó o quitó.
/// Llega a todas las ventanas (también a las de editor aparte).
pub const EV_VAULT_STATE: &str = "vault://state";
