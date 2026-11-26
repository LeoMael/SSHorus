//! Lo que pasa alrededor de una sesión abierta: el puente con el vigilante de reconexión, liberar
//! sus recursos y cerrarla de forma ordenada.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use super::keyring::non_empty;
use super::reconnect::{ReconnectEnv, ReconnectSettings};
use super::{SessionStore, SshSession};
use crate::error::{AppError, AppResult};
use crate::storage::{secrets, SettingsStore};
use crate::types::{
    SessionClosed, SessionInfo, SessionReconnecting, EV_SESSION_CLOSED, EV_SESSION_RECONNECTED, EV_SESSION_RECONNECTING,
};

/// Puente entre el vigilante de reconexión y la app Tauri.
pub(super) struct TauriEnv {
    pub(super) app: AppHandle,
}

impl ReconnectEnv for TauriEnv {
    fn sessions(&self) -> &SessionStore {
        self.app.state::<SessionStore>().inner()
    }

    fn settings(&self) -> ReconnectSettings {
        let s = self
            .app
            .try_state::<SettingsStore>()
            .map(|s| s.get())
            .unwrap_or_default();
        ReconnectSettings::from(&s)
    }

    fn emit_reconnecting(&self, ev: SessionReconnecting) {
        let _ = self.app.emit(EV_SESSION_RECONNECTING, ev);
    }

    fn emit_reconnected(&self, info: SessionInfo) {
        let _ = self.app.emit(EV_SESSION_RECONNECTED, info);
    }

    fn emit_closed(&self, ev: SessionClosed) {
        let _ = self.app.emit(EV_SESSION_CLOSED, ev);
    }

    fn release_dropped(&self, session_id: &str) {
        if let Some(t) = self.app.try_state::<crate::terminal::TerminalStore>() {
            t.close_session(session_id);
        }
        if let Some(s) = self.app.try_state::<crate::sftp::SftpStore>() {
            s.forget(session_id);
        }
    }

    fn release_all(&self, session_id: &str) {
        release_session_resources(&self.app, session_id);
    }

    fn resume(&self, session_id: &str) {
        if let Some(x) = self.app.try_state::<crate::transfer::TransferManager>() {
            x.resume_session(session_id);
        }
    }

    fn stored_secret(&self, profile_id: &str) -> futures::future::BoxFuture<'static, AppResult<Option<String>>> {
        let id = profile_id.to_string();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || secrets::get_secret(&id))
                .await
                .map_err(|e| AppError::Io(format!("tarea interrumpida: {e}")))?
                .map(non_empty)
        })
    }
}

/// Quita la sesión, libera sus recursos, la desconecta y avisa a la interfaz. Si ya estaba
/// cerrada no hace nada (no es un error para la interfaz).
pub async fn close(app: &AppHandle, sessions: &SessionStore, session_id: String) {
    let Some(session) = sessions.remove(&session_id).await else {
        return;
    };
    release_session_resources(app, &session_id);
    disconnect_session(&session).await;
    let _ = app.emit(
        EV_SESSION_CLOSED,
        SessionClosed {
            session_id,
            reason: "Desconectado".to_string(),
        },
    );
}

/// Libera terminales, canales SFTP del explorador y de transferencias de una sesión cerrada.
fn release_session_resources(app: &AppHandle, session_id: &str) {
    if let Some(t) = app.try_state::<crate::terminal::TerminalStore>() {
        t.close_session(session_id);
    }
    if let Some(s) = app.try_state::<crate::sftp::SftpStore>() {
        s.forget(session_id);
    }
    if let Some(x) = app.try_state::<crate::transfer::TransferManager>() {
        x.forget_session(session_id);
    }
}

/// Cierra la conexión de forma ordenada (sin esperar más de 3 s).
pub async fn disconnect_session(session: &SshSession) {
    if session.is_closed() {
        return;
    }
    let fut = session
        .handle
        .disconnect(russh::Disconnect::ByApplication, "Desconectado", "es");
    match tokio::time::timeout(Duration::from_secs(3), fut).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::debug!("disconnect: {e}"),
        Err(_) => log::debug!("disconnect: tiempo agotado"),
    }
}
