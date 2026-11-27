//! Sincronizaciones guardadas por servidor para reactivarlas al volver a conectar.
//! Van en su propio archivo (`folder_syncs.json`): `profiles.json` no cambia.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::model::{SavedSync, SyncSpec};
use crate::error::{AppError, AppResult};
use crate::storage::fsutil;

const FILE: &str = "folder_syncs.json";

/// Lecturas y escrituras de uno en uno (dos guardados seguidos no se pisan).
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Serialize, Deserialize)]
struct SavedFile {
    #[serde(default)]
    items: Vec<SavedSync>,
}

fn default_path() -> AppResult<PathBuf> {
    fsutil::config_dir()
        .map(|d| d.join(FILE))
        .ok_or_else(|| AppError::Io("No se encontró la carpeta de configuración".into()))
}

fn same(a: &SavedSync, server_id: &str, spec: &SyncSpec) -> bool {
    a.server_id == server_id && a.spec.local_dir == spec.local_dir && a.spec.remote_dir == spec.remote_dir
}

fn guard() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn list_in(path: &Path, server_id: &str) -> Vec<SavedSync> {
    let _g = guard();
    let data: SavedFile = fsutil::read_json_or_default(path);
    data.items.into_iter().filter(|s| s.server_id == server_id).collect()
}

/// Guarda (o actualiza) la sincronización de ese servidor con esas dos carpetas.
pub fn remember_in(path: &Path, server_id: &str, spec: &SyncSpec) -> AppResult<()> {
    let _g = guard();
    let mut data: SavedFile = fsutil::read_json_or_default(path);
    let item = SavedSync { server_id: server_id.to_string(), spec: spec.clone() };
    match data.items.iter_mut().find(|s| same(s, server_id, spec)) {
        Some(s) => *s = item,
        None => data.items.push(item),
    }
    fsutil::write_json_atomic(path, &data)
}

pub fn forget_in(path: &Path, server_id: &str, spec: &SyncSpec) -> AppResult<()> {
    let _g = guard();
    let mut data: SavedFile = fsutil::read_json_or_default(path);
    let before = data.items.len();
    data.items.retain(|s| !same(s, server_id, spec));
    if data.items.len() == before {
        return Ok(());
    }
    fsutil::write_json_atomic(path, &data)
}

/// Quita todas las de un servidor (al borrarlo).
pub fn forget_server_in(path: &Path, server_id: &str) -> AppResult<()> {
    let _g = guard();
    let mut data: SavedFile = fsutil::read_json_or_default(path);
    let before = data.items.len();
    data.items.retain(|s| s.server_id != server_id);
    if data.items.len() == before {
        return Ok(());
    }
    fsutil::write_json_atomic(path, &data)
}

/// Al borrar un servidor: olvida sus sincronizaciones guardadas. Errores solo al registro.
pub fn forget_server(server_id: &str) {
    if let Err(e) = default_path().and_then(|p| forget_server_in(&p, server_id)) {
        log::warn!("no se pudieron olvidar las sincronizaciones de {server_id}: {e}");
    }
}

pub fn list(server_id: &str) -> AppResult<Vec<SavedSync>> {
    Ok(list_in(&default_path()?, server_id))
}

pub fn remember(server_id: &str, spec: &SyncSpec) -> AppResult<()> {
    remember_in(&default_path()?, server_id, spec)
}

pub fn forget(server_id: &str, spec: &SyncSpec) -> AppResult<()> {
    forget_in(&default_path()?, server_id, spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(local: &str, remote: &str) -> SyncSpec {
        SyncSpec {
            local_dir: local.into(),
            remote_dir: remote.into(),
            ignore: vec!["*.log".into()],
            delete_remote: false,
        }
    }

    #[test]
    fn remember_update_and_forget() {
        let dir = std::env::temp_dir().join(format!("sshorus-syncs-{}", uuid::Uuid::new_v4()));
        let path = dir.join(FILE);
        assert!(list_in(&path, "s1").is_empty());

        remember_in(&path, "s1", &spec("/pc/web", "/var/www")).unwrap();
        remember_in(&path, "s2", &spec("/pc/web", "/srv")).unwrap();
        let mut changed = spec("/pc/web", "/var/www");
        changed.delete_remote = true;
        remember_in(&path, "s1", &changed).unwrap();

        let s1 = list_in(&path, "s1");
        assert_eq!(s1.len(), 1);
        assert!(s1[0].spec.delete_remote);
        assert_eq!(list_in(&path, "s2").len(), 1);

        forget_in(&path, "s1", &changed).unwrap();
        assert!(list_in(&path, "s1").is_empty());
        assert_eq!(list_in(&path, "s2").len(), 1);

        remember_in(&path, "s2", &spec("/pc/otra", "/srv/otra")).unwrap();
        remember_in(&path, "s1", &spec("/pc/web", "/var/www")).unwrap();
        forget_server_in(&path, "s2").unwrap();
        assert!(list_in(&path, "s2").is_empty());
        assert_eq!(list_in(&path, "s1").len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
