//! Operaciones SFTP sobre un canal ya abierto. Devuelven `OpResult` para que el
//! llamador sepa si el canal murió (y reintente) o si es un error normal.

use futures::stream::{self, StreamExt};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::io::AsyncReadExt;

use super::util::{self, is_status, Ctx, Fail, OpResult};
use crate::error::AppError;
use crate::types::{FileEntry, FileKind, RemoteText};

/// Peticiones simultáneas al resolver enlaces o borrar archivos.
pub(super) const PARALLEL: usize = 32;
/// Bytes que se revisan para detectar binarios.
const BINARY_PROBE: usize = 8 * 1024;

pub(super) fn invalid(msg: impl Into<String>) -> Fail {
    Fail::App(AppError::Invalid(msg.into()))
}

/// Ruta absoluta y sin barras finales; canonicaliza si es relativa.
pub(super) async fn absolute(s: &SftpSession, path: &str) -> OpResult<String> {
    let p = util::normalize(path.trim());
    if p.starts_with('/') {
        Ok(p)
    } else {
        canonicalize(s, if p.is_empty() { "." } else { &p }).await
    }
}

pub async fn canonicalize(s: &SftpSession, path: &str) -> OpResult<String> {
    s.canonicalize(path).await.ctx(path)
}

async fn exists(s: &SftpSession, path: &str) -> OpResult<bool> {
    match s.symlink_metadata(path).await {
        Ok(_) => Ok(true),
        Err(e) if is_status(&e, StatusCode::NoSuchFile) => Ok(false),
        Err(e) => Err(util::map_sftp(e, path)),
    }
}

fn already_exists(path: &str) -> Fail {
    invalid(format!("Ya existe un elemento llamado «{}»", util::basename(path)))
}

/// Si una creación falló con un error genérico, explica si es porque ya existe.
async fn explain_exists(s: &SftpSession, path: &str, err: russh_sftp::client::error::Error) -> Fail {
    if is_status(&err, StatusCode::Failure) && matches!(exists(s, path).await, Ok(true)) {
        return already_exists(path);
    }
    util::map_sftp(err, path)
}

pub(super) fn check_name(path: &str) -> OpResult<()> {
    let name = util::basename(path);
    if path.trim().is_empty() || name == "/" || name == "." || name == ".." {
        return Err(invalid("El nombre no es válido"));
    }
    Ok(())
}

// ───────────────────────── Lectura ─────────────────────────

pub async fn list_dir(s: &SftpSession, path: &str) -> OpResult<Vec<FileEntry>> {
    let dir = absolute(s, path).await?;
    let read = s.read_dir(dir.as_str()).await.ctx(&dir)?;

    let mut plain = Vec::new();
    let mut links = Vec::new();
    for e in read {
        let name = e.file_name();
        let full = util::join(&dir, &name);
        let attrs = e.metadata();
        if util::kind_of(attrs.permissions) == FileKind::Symlink {
            links.push((name, full, attrs));
        } else {
            plain.push(util::make_entry(name, full, &attrs, None));
        }
    }

    // Resuelve los enlaces en paralelo (peticiones en vuelo sobre el mismo canal).
    let resolved: Vec<(String, String, FileAttributes, Result<FileAttributes, russh_sftp::client::error::Error>)> =
        stream::iter(links)
            .map(|(name, full, attrs)| async move {
                let target = s.metadata(full.as_str()).await;
                (name, full, attrs, target)
            })
            .buffer_unordered(PARALLEL)
            .collect()
            .await;
    for (name, full, attrs, target) in resolved {
        match target {
            Ok(t) => plain.push(util::make_entry(name, full, &attrs, Some(&t))),
            // Enlace roto o sin permiso: se muestra igual, como enlace a archivo.
            Err(russh_sftp::client::error::Error::Status(_)) => {
                plain.push(util::make_entry(name, full, &attrs, None))
            }
            Err(e) => return Err(util::map_sftp(e, &dir)),
        }
    }

    util::sort_entries(&mut plain);
    Ok(plain)
}

pub async fn stat(s: &SftpSession, path: &str) -> OpResult<FileEntry> {
    let p = absolute(s, path).await?;
    let attrs = s.symlink_metadata(p.as_str()).await.ctx(&p)?;
    let target = if util::kind_of(attrs.permissions) == FileKind::Symlink {
        s.metadata(p.as_str()).await.ok()
    } else {
        None
    };
    Ok(util::make_entry(util::basename(&p), p, &attrs, target.as_ref()))
}

pub async fn read_text(s: &SftpSession, path: &str, max_bytes: u64) -> OpResult<RemoteText> {
    let p = absolute(s, path).await?;
    let attrs = s.metadata(p.as_str()).await.ctx(&p)?;
    match util::kind_of(attrs.permissions) {
        FileKind::Dir => return Err(invalid(format!("«{}» es una carpeta", util::basename(&p)))),
        FileKind::Other => {
            return Err(invalid(format!("«{}» no es un archivo normal", util::basename(&p))))
        }
        _ => {}
    }
    let size = attrs.size.unwrap_or(0);
    if size > max_bytes {
        return Err(Fail::App(AppError::FileTooLarge(size)));
    }

    let file = s.open(p.as_str()).await.ctx(&p)?;
    let mut buf = Vec::with_capacity(size as usize);
    // Límite por si el archivo creció entre stat y lectura.
    let mut limited = file.take(max_bytes.saturating_add(1));
    limited.read_to_end(&mut buf).await.ctx(&p)?;
    let file = limited.into_inner();
    let _ = file.close().await;
    if buf.len() as u64 > max_bytes {
        return Err(Fail::App(AppError::FileTooLarge(buf.len() as u64)));
    }

    let not_text = || invalid(format!("«{}» no es un archivo de texto", util::basename(&p)));
    if buf[..buf.len().min(BINARY_PROBE)].contains(&0) {
        return Err(not_text());
    }
    let content = String::from_utf8(buf).map_err(|_| not_text())?;
    Ok(RemoteText {
        path: p,
        size: content.len() as u64,
        content,
        modified: attrs.mtime.map(u64::from),
    })
}

/// Trozo de un archivo: hasta `max_bytes` desde `offset` (para el asistente: sin error si es grande).
pub async fn read_part(s: &SftpSession, path: &str, offset: u64, max_bytes: u64) -> OpResult<FilePart> {
    use tokio::io::AsyncSeekExt;
    let p = absolute(s, path).await?;
    let attrs = s.metadata(p.as_str()).await.ctx(&p)?;
    match util::kind_of(attrs.permissions) {
        FileKind::Dir => return Err(invalid(format!("«{}» es una carpeta", util::basename(&p)))),
        FileKind::Other => return Err(invalid(format!("«{}» no es un archivo normal", util::basename(&p)))),
        _ => {}
    }
    let size = attrs.size.unwrap_or(0);
    let mut file = s.open(p.as_str()).await.ctx(&p)?;
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset)).await.ctx(&p)?;
    }
    let mut buf = Vec::new();
    let mut limited = file.take(max_bytes);
    limited.read_to_end(&mut buf).await.ctx(&p)?;
    let file = limited.into_inner();
    let _ = file.close().await;
    Ok(FilePart { path: p, size, offset, data: buf })
}

/// Resultado de [`read_part`].
pub struct FilePart {
    pub path: String,
    /// Tamaño total del archivo.
    pub size: u64,
    pub offset: u64,
    pub data: Vec<u8>,
}

// ───────────────────────── Creación / cambios ─────────────────────────

pub async fn mkdir(s: &SftpSession, path: &str) -> OpResult<()> {
    let p = absolute(s, path).await?;
    check_name(&p)?;
    match s.create_dir(p.as_str()).await {
        Ok(()) => Ok(()),
        Err(e) => Err(explain_exists(s, &p, e).await),
    }
}

pub async fn create_file(s: &SftpSession, path: &str) -> OpResult<()> {
    let p = absolute(s, path).await?;
    check_name(&p)?;
    let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
    match s.open_with_flags(p.as_str(), flags).await {
        Ok(f) => f.close().await.ctx(&p),
        Err(e) => Err(explain_exists(s, &p, e).await),
    }
}

pub async fn rename(s: &SftpSession, from: &str, to: &str) -> OpResult<()> {
    let from = absolute(s, from).await?;
    let to = absolute(s, to).await?;
    check_name(&to)?;
    if from == to {
        return Ok(());
    }
    // Permite cambiar solo mayúsculas/minúsculas en sistemas que no las distinguen.
    if !from.eq_ignore_ascii_case(&to) && exists(s, &to).await? {
        return Err(already_exists(&to));
    }
    match s.rename(from.as_str(), to.as_str()).await {
        Ok(()) => Ok(()),
        Err(e) if is_status(&e, StatusCode::NoSuchFile) => Err(util::map_sftp(e, &from)),
        Err(e) => Err(explain_exists(s, &to, e).await),
    }
}

pub async fn chmod(s: &SftpSession, path: &str, mode: u32) -> OpResult<()> {
    let p = absolute(s, path).await?;
    let attrs = s.metadata(p.as_str()).await.ctx(&p)?;
    let old = attrs.permissions.unwrap_or(0);
    let new = (old & !0o7777) | (mode & 0o7777);
    let set = FileAttributes { permissions: Some(new), ..FileAttributes::empty() };
    s.set_metadata(p.as_str(), set).await.ctx(&p)
}
