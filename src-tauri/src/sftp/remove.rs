//! Borrar archivos y carpetas (recursivo, sin seguir nunca los enlaces simbólicos).

use futures::future::BoxFuture;
use futures::stream::{self, StreamExt};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::StatusCode;

use super::ops::{absolute, invalid, PARALLEL};
use super::util::{self, is_status, Ctx, OpResult};
use crate::types::FileKind;

pub async fn delete(s: &SftpSession, paths: &[String]) -> OpResult<()> {
    for path in paths {
        let p = absolute(s, path).await?;
        if p == "/" || p.is_empty() {
            return Err(invalid("No se puede borrar la raíz del sistema"));
        }
        // lstat: un symlink se borra como archivo (nunca se sigue).
        let attrs = s.symlink_metadata(p.as_str()).await.ctx(&p)?;
        if util::kind_of(attrs.permissions) == FileKind::Dir {
            remove_tree(s, p).await?;
        } else {
            remove_file(s, &p).await?;
        }
    }
    Ok(())
}

async fn remove_file(s: &SftpSession, path: &str) -> OpResult<()> {
    match s.remove_file(path).await {
        Ok(()) => Ok(()),
        Err(e) if is_status(&e, StatusCode::NoSuchFile) => Ok(()),
        Err(e) => Err(util::map_sftp(e, path)),
    }
}

fn remove_tree(s: &SftpSession, dir: String) -> BoxFuture<'_, OpResult<()>> {
    Box::pin(async move {
        let read = s.read_dir(dir.as_str()).await.ctx(&dir)?;
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        for e in read {
            let full = util::join(&dir, &e.file_name());
            // Los atributos de readdir son de lstat: un enlace a carpeta NO es carpeta aquí.
            if util::kind_of(e.metadata().permissions) == FileKind::Dir {
                dirs.push(full);
            } else {
                files.push(full);
            }
        }
        let results: Vec<OpResult<()>> = stream::iter(files)
            .map(|f| async move { remove_file(s, &f).await })
            .buffer_unordered(PARALLEL)
            .collect()
            .await;
        for r in results {
            r?;
        }
        for d in dirs {
            remove_tree(s, d).await?;
        }
        match s.remove_dir(dir.as_str()).await {
            Ok(()) => Ok(()),
            Err(e) if is_status(&e, StatusCode::NoSuchFile) => Ok(()),
            Err(e) => Err(util::map_sftp(e, &dir)),
        }
    })
}
