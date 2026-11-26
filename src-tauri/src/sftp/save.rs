//! Guardado atómico del editor: temporal en la misma carpeta y renombrar encima, conservando
//! permisos y dueño (o escribir in situ si no se puede).

use std::sync::Arc;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::AsyncWriteExt;

use super::ops::{absolute, canonicalize, check_name, invalid, stat};
use super::util::{self, is_status, Ctx, OpResult};
use super::SftpStore;
use crate::ssh::SshSession;
use crate::types::{FileEntry, FileKind};

/// Guarda `content` en `path`:
/// 1. escribe un temporal `.<nombre>.sshorus-<rand>` en la misma carpeta con los permisos del original;
/// 2. lo coloca encima con `posix-rename@openssh.com` (o borrar + renombrar si no existe la extensión).
///
/// Si no se puede crear el temporal (carpeta sin permiso de escritura) o no se puede conservar
/// el dueño del archivo, escribe directamente sobre el original.
pub async fn write_text(store: &SftpStore, ssh: &Arc<SshSession>, s: &SftpSession, path: &str, content: &str) -> OpResult<FileEntry> {
    let p = absolute(s, path).await?;
    check_name(&p)?;

    // Destino real (si es un symlink, se escribe en el archivo al que apunta).
    let (target, orig) = match s.symlink_metadata(p.as_str()).await {
        Ok(a) => match util::kind_of(a.permissions) {
            FileKind::Dir => return Err(invalid(format!("«{}» es una carpeta", util::basename(&p)))),
            FileKind::Symlink => {
                let real = canonicalize(s, &p).await?;
                let ra = s.metadata(real.as_str()).await.ctx(&real)?;
                if util::kind_of(ra.permissions) == FileKind::Dir {
                    return Err(invalid(format!("«{}» es una carpeta", util::basename(&p))));
                }
                (real, Some(ra))
            }
            _ => (p.clone(), Some(a)),
        },
        Err(e) if is_status(&e, StatusCode::NoSuchFile) => (p.clone(), None),
        Err(e) => return Err(util::map_sftp(e, &p)),
    };

    let dir = util::parent(&target);
    let name = util::basename(&target);
    let rand = uuid::Uuid::new_v4().simple().to_string();
    let tmp = util::join(&dir, &format!(".{name}.sshorus-{}", &rand[..8]));
    let perms = orig.as_ref().and_then(|a| a.permissions).map(|m| m & 0o7777);

    let open_attrs = FileAttributes { permissions: perms, ..FileAttributes::empty() };
    let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
    let file = match s.open_with_flags_and_attributes(tmp.as_str(), flags, open_attrs).await {
        Ok(f) => f,
        Err(e) if orig.is_some() && is_status(&e, StatusCode::PermissionDenied) => {
            write_in_place(s, &target, content).await?;
            return stat(s, &p).await;
        }
        Err(e) => return Err(util::map_sftp(e, &dir)),
    };

    let result: OpResult<bool> = async {
        let mut file = file;
        file.write_all(content.as_bytes()).await.ctx(&tmp)?;
        file.flush().await.ctx(&tmp)?;
        let _ = file.sync_all().await;
        // Permisos explícitos (la creación aplica la umask del servidor).
        if let Some(m) = perms {
            let set = FileAttributes { permissions: Some(m), ..FileAttributes::empty() };
            file.set_metadata(set).await.ctx(&tmp)?;
        }
        // Dueño: si el temporal no queda con el mismo uid/gid y no se puede cambiar, mejor in situ.
        if let Some(o) = &orig {
            let t = file.metadata().await.ctx(&tmp)?;
            let same = (o.uid.is_none() || o.uid == t.uid) && (o.gid.is_none() || o.gid == t.gid);
            if !same {
                let set = FileAttributes { uid: o.uid, gid: o.gid, ..FileAttributes::empty() };
                if file.set_metadata(set).await.is_err() {
                    let _ = file.close().await;
                    return Ok(false);
                }
            }
        }
        file.close().await.ctx(&tmp)?;
        replace(store, ssh, s, &tmp, &target, orig.is_some()).await?;
        Ok(true)
    }
    .await;

    match result {
        Ok(true) => stat(s, &p).await,
        Ok(false) => {
            let _ = s.remove_file(tmp.as_str()).await;
            write_in_place(s, &target, content).await?;
            stat(s, &p).await
        }
        Err(e) => {
            let _ = s.remove_file(tmp.as_str()).await;
            Err(e)
        }
    }
}

async fn replace(store: &SftpStore, ssh: &Arc<SshSession>, s: &SftpSession, tmp: &str, target: &str, target_exists: bool) -> OpResult<()> {
    if store.posix_rename(ssh, tmp, target).await? {
        return Ok(());
    }
    if target_exists {
        s.remove_file(target).await.ctx(target)?;
    }
    s.rename(tmp, target).await.ctx(target)
}

async fn write_in_place(s: &SftpSession, target: &str, content: &str) -> OpResult<()> {
    let flags = OpenFlags::WRITE | OpenFlags::TRUNCATE;
    let mut file = s.open_with_flags(target, flags).await.ctx(target)?;
    file.write_all(content.as_bytes()).await.ctx(target)?;
    file.flush().await.ctx(target)?;
    let _ = file.sync_all().await;
    file.close().await.ctx(target)
}
