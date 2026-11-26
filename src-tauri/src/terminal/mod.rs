//! Terminales (shell con PTY) sobre un canal SSH. DUEÑO: agente Terminal.
//!
//! Datos del servidor → interfaz: por el `Channel` recibido en `term_open`,
//! enviando `InvokeResponseBody::Raw(bytes)` (llega como ArrayBuffer en JS).
//! Cuando la shell termina: evento global `EV_TERMINAL_EXIT` con `TerminalExit`.

mod batch;
pub mod commands;
mod open;
pub mod shell;
pub mod tmux;

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;

pub use shell::{spawn_terminal, ShellStart, TerminalHandle};
use tmux::{ProbeResult, TmuxProbe};

struct TermEntry {
    handle: TerminalHandle,
    #[allow(dead_code)]
    session_id: String,
}

/// Terminales abiertas: termId → shell.
#[derive(Default)]
pub struct TerminalStore {
    terms: Mutex<HashMap<String, TermEntry>>,
    /// tmux en cada sesión. «No instalado» se recuerda poco tiempo: si el usuario lo instala,
    /// una terminal abierta poco después ya lo usa.
    tmux: Mutex<HashMap<String, CachedProbe>>,
}

#[derive(Clone)]
enum CachedProbe {
    Found(TmuxProbe),
    Missing(std::time::Instant),
}

/// Cuánto se recuerda que una sesión no tiene tmux (evita comprobarlo en cada terminal nueva).
const MISSING_TTL: std::time::Duration = std::time::Duration::from_secs(20);

impl TerminalStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, TermEntry>> {
        self.terms.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, term_id: &str) -> AppResult<TerminalHandle> {
        self.lock()
            .get(term_id)
            .map(|e| e.handle.clone())
            .ok_or_else(|| AppError::NotFound(format!("terminal {term_id}")))
    }

    /// Registra la terminal salvo que ya haya terminado (evita entradas huérfanas).
    fn insert(&self, term_id: String, session_id: String, handle: TerminalHandle) {
        let mut map = self.lock();
        if !handle.is_finished() {
            map.insert(term_id, TermEntry { handle, session_id });
        }
    }

    fn remove(&self, term_id: &str) -> Option<TerminalHandle> {
        self.lock().remove(term_id).map(|e| e.handle)
    }

    /// Envía lo que el usuario teclea.
    pub fn write(&self, term_id: &str, data: Vec<u8>) -> AppResult<()> {
        self.get(term_id)?.write(data)
    }

    pub fn resize(&self, term_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        self.get(term_id)?.resize(cols, rows)
    }

    /// Cierra la terminal `term_id`.
    pub fn close(&self, term_id: &str) -> AppResult<()> {
        match self.remove(term_id) {
            Some(handle) => {
                handle.close();
                Ok(())
            }
            None => Err(AppError::NotFound(format!("terminal {term_id}"))),
        }
    }

    /// Cierra todas las terminales de una sesión.
    pub fn close_session(&self, session_id: &str) {
        {
            let map = self.lock();
            for e in map.values().filter(|e| e.session_id == session_id) {
                e.handle.close();
            }
        }
        self.tmux_cache().remove(session_id);
    }

    fn tmux_cache(&self) -> std::sync::MutexGuard<'_, HashMap<String, CachedProbe>> {
        self.tmux.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Busca tmux en la sesión (con caché).
    async fn probe_tmux(&self, session_id: &str, session: &SshSession) -> AppResult<ProbeResult> {
        match self.tmux_cache().get(session_id).cloned() {
            Some(CachedProbe::Found(p)) => return Ok(ProbeResult::Found(p)),
            Some(CachedProbe::Missing(at)) if at.elapsed() < MISSING_TTL => return Ok(ProbeResult::NotInstalled),
            _ => {}
        }
        let r = tmux::probe(session).await?;
        let cached = match &r {
            ProbeResult::Found(p) => CachedProbe::Found(p.clone()),
            ProbeResult::NotInstalled => CachedProbe::Missing(std::time::Instant::now()),
        };
        self.tmux_cache().insert(session_id.to_string(), cached);
        Ok(r)
    }
}
