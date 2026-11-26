//! Navegación y edición de archivos remotos por SFTP. DUEÑO: agente SFTP.
//!
//! Mantiene un `SftpSession` por sesión SSH (perezoso) para el explorador.
//! Las transferencias masivas NO usan este canal: tienen los suyos (módulo transfer).
//!
//! Si el canal SFTP muere (p. ej. el servidor cerró el subsistema), la operación
//! descarta el canal, abre uno nuevo y reintenta una vez.

pub mod commands;
mod ops;
mod remove;
mod save;
mod util;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use russh_sftp::client::{RawSftpSession, SftpSession};
use russh_sftp::protocol::Packet;

use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use crate::types::{FileEntry, RemoteText};

use util::{Fail, OpResult};

pub use ops::FilePart;

const POSIX_RENAME: &str = "posix-rename@openssh.com";

/// Canal "crudo" usado solo para extensiones que la API de alto nivel no expone
/// (`posix-rename@openssh.com`).
struct RawConn {
    raw: RawSftpSession,
    posix_rename: bool,
}

#[derive(Default)]
struct Slot {
    /// Conexión SSH dueña de los canales. Si la sesión se reconecta (mismo id, conexión
    /// nueva), los canales viejos están muertos y se descartan sin esperar a que fallen.
    owner: Weak<SshSession>,
    sftp: Option<Arc<SftpSession>>,
    raw: Option<Arc<RawConn>>,
}

impl Slot {
    fn check_owner(&mut self, ssh: &Arc<SshSession>) {
        let current = Arc::downgrade(ssh);
        if !Weak::ptr_eq(&self.owner, &current) {
            self.sftp = None;
            self.raw = None;
            self.owner = current;
        }
    }
}

/// Canales SFTP abiertos por sesión SSH (uno por sesión, perezoso).
#[derive(Default)]
pub struct SftpStore {
    slots: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Slot>>>>,
}

impl SftpStore {
    fn slot(&self, id: &str) -> Arc<tokio::sync::Mutex<Slot>> {
        let mut map = match self.slots.lock() {
            Ok(m) => m,
            Err(p) => p.into_inner(),
        };
        map.entry(id.to_string()).or_default().clone()
    }

    /// Olvida los canales de una sesión (p. ej. al desconectar).
    pub fn forget(&self, session_id: &str) {
        let mut map = match self.slots.lock() {
            Ok(m) => m,
            Err(p) => p.into_inner(),
        };
        map.remove(session_id);
    }

    /// Devuelve (o abre) el canal SFTP de la sesión. El candado del slot es por sesión
    /// y solo se mantiene mientras se abre el canal (evita aperturas duplicadas).
    async fn get(&self, ssh: &Arc<SshSession>) -> AppResult<Arc<SftpSession>> {
        let slot = self.slot(&ssh.info.id);
        let mut g = slot.lock().await;
        g.check_owner(ssh);
        if let Some(s) = &g.sftp {
            return Ok(s.clone());
        }
        let s = Arc::new(ssh.open_sftp().await?);
        g.sftp = Some(s.clone());
        Ok(s)
    }

    /// Descarta el canal si sigue siendo el mismo que falló.
    async fn invalidate(&self, ssh: &Arc<SshSession>, dead: &Arc<SftpSession>) {
        let slot = self.slot(&ssh.info.id);
        let mut g = slot.lock().await;
        if g.sftp.as_ref().is_some_and(|s| Arc::ptr_eq(s, dead)) {
            g.sftp = None;
        }
    }

    async fn get_raw(&self, ssh: &Arc<SshSession>) -> AppResult<Arc<RawConn>> {
        let slot = self.slot(&ssh.info.id);
        let mut g = slot.lock().await;
        g.check_owner(ssh);
        if let Some(r) = &g.raw {
            return Ok(r.clone());
        }
        let channel = ssh.open_channel().await?;
        channel.request_subsystem(true, "sftp").await?;
        let raw = RawSftpSession::new(channel.into_stream());
        let version = raw.init().await?;
        let posix_rename = version.extensions.contains_key(POSIX_RENAME);
        let conn = Arc::new(RawConn { raw, posix_rename });
        g.raw = Some(conn.clone());
        Ok(conn)
    }

    async fn invalidate_raw(&self, ssh: &Arc<SshSession>) {
        let slot = self.slot(&ssh.info.id);
        slot.lock().await.raw = None;
    }

    /// Renombra sobrescribiendo de forma atómica con `posix-rename@openssh.com`.
    /// Devuelve `Ok(false)` si el servidor no admite la extensión.
    async fn posix_rename(&self, ssh: &Arc<SshSession>, from: &str, to: &str) -> OpResult<bool> {
        for attempt in 0..2 {
            let conn = self.get_raw(ssh).await?;
            if !conn.posix_rename {
                return Ok(false);
            }
            let mut data = Vec::with_capacity(8 + from.len() + to.len());
            for s in [from, to] {
                data.extend_from_slice(&(s.len() as u32).to_be_bytes());
                data.extend_from_slice(s.as_bytes());
            }
            match conn.raw.extended(POSIX_RENAME, data).await {
                Ok(Packet::Status(s)) if s.status_code == russh_sftp::protocol::StatusCode::Ok => return Ok(true),
                Ok(Packet::Status(s)) => return Err(util::map_sftp(s.into(), to)),
                Ok(_) => return Err(Fail::App(AppError::Sftp("respuesta inesperada del servidor".into()))),
                Err(e) => match util::map_sftp(e, to) {
                    Fail::Channel(_) if attempt == 0 => self.invalidate_raw(ssh).await,
                    other => return Err(other),
                },
            }
        }
        Err(Fail::App(AppError::Sftp("no se pudo abrir el canal SFTP".into())))
    }
}

/// Ejecuta `$body` con el canal SFTP `$s`; si el canal murió, lo reabre y reintenta una vez.
macro_rules! with_sftp {
    ($store:expr, $ssh:expr, |$s:ident| $body:expr) => {{
        let mut attempt = 0u8;
        loop {
            let $s = $store.get($ssh).await?;
            let r: util::OpResult<_> = async { $body }.await;
            match r {
                Ok(v) => break Ok(v),
                Err(util::Fail::Channel(msg)) if attempt == 0 => {
                    log::warn!("canal SFTP caído ({msg}); se reabre");
                    $store.invalidate($ssh, &$s).await;
                    attempt += 1;
                }
                Err(e) => break Err(e.into_app()),
            }
        }
    }};
}

// ───────────────────────── API usada por los comandos (y los tests) ─────────────────────────

impl SftpStore {
    pub async fn home(&self, ssh: &Arc<SshSession>) -> AppResult<String> {
        with_sftp!(self, ssh, |s| ops::canonicalize(&s, ".").await)
    }

    /// Ruta real (el servidor sigue los enlaces simbólicos y «..»).
    pub async fn realpath(&self, ssh: &Arc<SshSession>, path: &str) -> AppResult<String> {
        with_sftp!(self, ssh, |s| ops::canonicalize(&s, path).await)
    }

    pub async fn list_dir(&self, ssh: &Arc<SshSession>, path: &str) -> AppResult<Vec<FileEntry>> {
        with_sftp!(self, ssh, |s| ops::list_dir(&s, path).await)
    }

    pub async fn stat(&self, ssh: &Arc<SshSession>, path: &str) -> AppResult<FileEntry> {
        with_sftp!(self, ssh, |s| ops::stat(&s, path).await)
    }

    pub async fn mkdir(&self, ssh: &Arc<SshSession>, path: &str) -> AppResult<()> {
        with_sftp!(self, ssh, |s| ops::mkdir(&s, path).await)
    }

    pub async fn create_file(&self, ssh: &Arc<SshSession>, path: &str) -> AppResult<()> {
        with_sftp!(self, ssh, |s| ops::create_file(&s, path).await)
    }

    pub async fn rename(&self, ssh: &Arc<SshSession>, from: &str, to: &str) -> AppResult<()> {
        with_sftp!(self, ssh, |s| ops::rename(&s, from, to).await)
    }

    pub async fn delete(&self, ssh: &Arc<SshSession>, paths: &[String]) -> AppResult<()> {
        with_sftp!(self, ssh, |s| remove::delete(&s, paths).await)
    }

    pub async fn chmod(&self, ssh: &Arc<SshSession>, path: &str, mode: u32) -> AppResult<()> {
        with_sftp!(self, ssh, |s| ops::chmod(&s, path, mode).await)
    }

    pub async fn read_text(&self, ssh: &Arc<SshSession>, path: &str, max_bytes: u64) -> AppResult<RemoteText> {
        with_sftp!(self, ssh, |s| ops::read_text(&s, path, max_bytes).await)
    }

    /// Hasta `max_bytes` desde `offset`, sin error si el archivo es más grande (asistente MCP).
    pub async fn read_part(&self, ssh: &Arc<SshSession>, path: &str, offset: u64, max_bytes: u64) -> AppResult<ops::FilePart> {
        with_sftp!(self, ssh, |s| ops::read_part(&s, path, offset, max_bytes).await)
    }
    pub async fn write_text(&self, ssh: &Arc<SshSession>, path: &str, content: &str) -> AppResult<FileEntry> {
        with_sftp!(self, ssh, |s| save::write_text(self, ssh, &s, path, content).await)
    }
}
