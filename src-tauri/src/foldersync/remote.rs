//! Lo que hay en la carpeta del servidor (para la comparación inicial) y borrados remotos.

use std::collections::HashMap;
use std::sync::Arc;

use futures::stream::{self, StreamExt};

use super::filter::IgnoreRules;
use super::plan::{remote_path, safe_rel, RemoteStamp};
use crate::error::{AppError, AppResult};
use crate::sftp::SftpStore;
use crate::ssh::SshSession;
use crate::types::FileKind;

/// Carpetas que se leen a la vez.
const PARALLEL_DIRS: usize = 8;

/// Archivos de `root` (recursivo, sin seguir enlaces ni entrar en lo ignorado), como mucho
/// `limit`. Si la carpeta aún no existe, está vacía.
pub async fn list_tree(
    sftp: &SftpStore,
    ssh: &Arc<SshSession>,
    root: &str,
    rules: &IgnoreRules,
    limit: usize,
) -> AppResult<HashMap<String, RemoteStamp>> {
    let mut out = HashMap::new();
    let mut level: Vec<String> = vec![String::new()];
    while !level.is_empty() && out.len() < limit {
        let lists: Vec<(String, AppResult<Vec<crate::types::FileEntry>>)> = stream::iter(level)
            .map(|rel| async move {
                let path = if rel.is_empty() { root.to_string() } else { remote_path(root, &rel) };
                let r = sftp.list_dir(ssh, &path).await;
                (rel, r)
            })
            .buffer_unordered(PARALLEL_DIRS)
            .collect()
            .await;
        let mut next = Vec::new();
        for (rel, r) in lists {
            let entries = match r {
                Ok(e) => e,
                Err(AppError::NotFound(_)) if rel.is_empty() => return Ok(out),
                Err(e) if rel.is_empty() => return Err(e),
                // Una subcarpeta ilegible no impide comparar el resto.
                Err(e) => {
                    log::warn!("sincronizar: no se pudo leer {rel}: {e}");
                    continue;
                }
            };
            for e in entries {
                let child = if rel.is_empty() { e.name.clone() } else { format!("{rel}/{}", e.name) };
                match e.kind {
                    FileKind::Dir if !rules.is_ignored(&child, true) => next.push(child),
                    FileKind::File if !rules.is_ignored(&child, false) => {
                        out.insert(child, RemoteStamp { size: e.size, mtime: e.modified });
                    }
                    _ => {}
                }
            }
        }
        level = next;
    }
    Ok(out)
}

/// Borra en el servidor los archivos `rels` de `root` (lo que ya no está no es un error).
pub async fn delete_files(sftp: &SftpStore, ssh: &Arc<SshSession>, root: &str, rels: &[String]) -> AppResult<()> {
    // De uno en uno: `delete` se para en el primero que ya no existe. Solo archivos y enlaces:
    // una carpeta del servidor nunca se borra entera por un archivo que faltaba en el PC.
    for rel in rels.iter().filter(|r| safe_rel(r)) {
        let path = remote_path(root, rel);
        match sftp.stat(ssh, &path).await {
            Ok(e) if e.kind == FileKind::Dir => continue,
            Ok(_) => {}
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        }
        match sftp.delete(ssh, &[path]).await {
            Ok(()) | Err(AppError::NotFound(_)) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
