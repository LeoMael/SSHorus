//! Archivo del historial de cada servidor: `<config>/sshorus/history/<idServidor>.jsonl`.
//!
//! Una línea JSON por entrada, 0600. Al pasar de `ROTATE_BYTES` se renombra a `<id>.1.jsonl` (pisando el
//! anterior): como mucho ~2 × `ROTATE_BYTES` por servidor. Se borra al borrar el servidor.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::model::HistoryEvent;
use crate::error::{AppError, AppResult};
use crate::mcp::audit::{clip, now_ms};
use crate::storage::fsutil;

/// Tamaño a partir del cual se rota el archivo de un servidor.
pub const ROTATE_BYTES: u64 = 512 * 1024;
/// Entradas que se devuelven como mucho (las más nuevas).
pub const MAX_LIST: usize = 3000;
const MAX_TITLE: usize = 300;
const MAX_DETAIL: usize = 4000;
const MAX_RESULT: usize = 2000;

/// Una escritura a la vez (dos tareas que terminan juntas no mezclan sus líneas).
static LOCK: Mutex<()> = Mutex::new(());

pub struct HistoryStore {
    dir: Option<PathBuf>,
}

impl HistoryStore {
    pub fn system() -> Self {
        HistoryStore { dir: fsutil::config_dir().map(|d| d.join("history")) }
    }

    #[cfg(test)]
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        HistoryStore { dir: Some(dir.into()) }
    }

    /// (actual, rotado) del servidor.
    fn paths(&self, server_id: &str) -> AppResult<(PathBuf, PathBuf)> {
        let id = server_id.trim();
        if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(AppError::Invalid("Identificador de servidor no válido".into()));
        }
        let dir = self.dir.as_ref().ok_or_else(|| AppError::Io("no hay carpeta de configuración".into()))?;
        Ok((dir.join(format!("{id}.jsonl")), dir.join(format!("{id}.1.jsonl"))))
    }

    /// Guarda la entrada (ya tapada) con id y hora nuevos. Devuelve cómo quedó.
    pub fn append(&self, server_id: &str, mut ev: HistoryEvent) -> AppResult<HistoryEvent> {
        let (path, old) = self.paths(server_id)?;
        ev.id = uuid::Uuid::new_v4().to_string();
        ev.at = now_ms();
        ev.title = clip(ev.title.trim(), MAX_TITLE);
        ev.detail = clip(&ev.detail, MAX_DETAIL);
        ev.result = clip(&ev.result, MAX_RESULT);
        if ev.title.is_empty() {
            return Err(AppError::Invalid("Entrada del historial vacía".into()));
        }
        let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(dir) = path.parent() {
            fsutil::ensure_private_dir(dir)?;
        }
        if fs::metadata(&path).is_ok_and(|m| m.len() >= ROTATE_BYTES) {
            fs::rename(&path, &old)?;
        }
        let mut line = serde_json::to_string(&ev)?;
        line.push('\n');
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        opts.open(&path)?.write_all(line.as_bytes())?;
        Ok(ev)
    }

    /// Lo más nuevo primero (como mucho `MAX_LIST`). Las líneas que no se entienden se saltan.
    pub fn list(&self, server_id: &str) -> AppResult<Vec<HistoryEvent>> {
        let (path, old) = self.paths(server_id)?;
        let mut all = read_lines(&old);
        all.extend(read_lines(&path));
        all.reverse();
        all.truncate(MAX_LIST);
        Ok(all)
    }

    /// Borra todo el historial guardado de este servidor.
    pub fn clear(&self, server_id: &str) -> AppResult<()> {
        let (path, old) = self.paths(server_id)?;
        let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        for p in [path, old] {
            match fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(AppError::Io(format!("no se pudo borrar el historial: {e}"))),
            }
        }
        Ok(())
    }
}

fn read_lines(path: &Path) -> Vec<HistoryEvent> {
    let Ok(f) = fs::File::open(path) else { return Vec::new() };
    BufReader::new(f)
        .lines()
        .map_while(Result::ok)
        .filter_map(|l| serde_json::from_str::<HistoryEvent>(&l).ok())
        .collect()
}

/// Borra el historial de un servidor (al borrar el servidor). Errores solo al registro.
pub fn forget_server(server_id: &str) {
    if let Err(e) = HistoryStore::system().clear(server_id) {
        log::warn!("no se pudo borrar el historial de {server_id}: {e}");
    }
}
