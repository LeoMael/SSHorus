//! Destinos que ya existen y enlaces simbólicos (subida, bajada y particularidades de Windows).

use std::path::Path;

use super::super::copy::{self, CopyError, CopyResult};
use super::super::paths::{local_io_message, remote_kind, remote_parent, RemoteKind};
use super::super::pool::Chan;
use super::state::Outcome;

/// Fecha (segundos Unix) y tamaño de un destino que ya existe, si se conocen.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DestMeta {
    pub(super) mtime: Option<u64>,
    pub(super) size: Option<u64>,
}

/// ¿Existe el destino remoto? `None` = no existe (sin seguir enlaces).
pub(super) async fn remote_dest(chan: &Chan, path: &str) -> CopyResult<Option<DestMeta>> {
    match chan.raw.lstat(path.to_string()).await {
        Ok(a) => Ok(Some(DestMeta {
            mtime: a.attrs.mtime.map(u64::from),
            size: a.attrs.size,
        })),
        Err(e) if copy::is_no_such_file(&e) => Ok(None),
        Err(e) => Err(copy::sftp_err(e)),
    }
}

/// ¿Existe el destino local? (sin seguir enlaces).
pub(super) async fn local_dest(path: &Path) -> CopyResult<Option<DestMeta>> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(m) => Ok(Some(DestMeta {
            mtime: copy::unix_secs_u64(m.modified()),
            size: m.is_file().then_some(m.len()),
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(CopyError::Fatal(local_io_message(&e))),
    }
}

/// Recrea un enlace simbólico local en el servidor (mismo objetivo). La política de
/// conflictos ya se aplicó en `attempt`.
pub(super) async fn upload_link(chan: &Chan, remote: &str, target: Option<&str>) -> CopyResult<Outcome> {
    let Some(target) = target else {
        return Err(CopyError::Fatal("Falta el destino del enlace".into()));
    };
    let raw = &chan.raw;
    let dest = remote_dest(chan, remote).await?;
    if dest.is_some() {
        let is_dir = raw
            .lstat(remote.to_string())
            .await
            .is_ok_and(|a| remote_kind(a.attrs.permissions) == RemoteKind::Dir);
        if is_dir {
            return Err(CopyError::Fatal("Ya existe una carpeta con ese nombre en el servidor".into()));
        }
        raw.remove(remote.to_string()).await.map_err(copy::sftp_err)?;
    }
    // OpenSSH (sftp-server) espera los argumentos al revés que el estándar:
    // primero el objetivo y luego la ruta del enlace.
    match raw.symlink(target.to_string(), remote.to_string()).await {
        Ok(_) => Ok(Outcome::Copied(0)),
        Err(e) if copy::is_no_such_file(&e) => {
            copy::remote_mkdir_p(chan, &remote_parent(remote)).await.map_err(copy::sftp_err)?;
            raw.symlink(target.to_string(), remote.to_string())
                .await
                .map_err(copy::sftp_err)?;
            Ok(Outcome::Copied(0))
        }
        Err(e) => Err(copy::sftp_err(e)),
    }
}

/// Recrea un enlace simbólico remoto en el equipo local (mismo objetivo).
pub(super) async fn download_link(chan: &Chan, remote: &str, local: &Path) -> CopyResult<Outcome> {
    let name = chan.raw.readlink(remote.to_string()).await.map_err(copy::sftp_err)?;
    let Some(target) = name.files.into_iter().next().map(|f| f.filename).filter(|t| !t.is_empty()) else {
        return Err(CopyError::Fatal("El servidor no devolvió el destino del enlace".into()));
    };
    let dest = local_dest(local).await?;
    let lerr = |e: std::io::Error| CopyError::Fatal(local_io_message(&e));
    if dest.is_some() {
        let meta = tokio::fs::symlink_metadata(local).await.map_err(lerr)?;
        if meta.is_dir() {
            return Err(CopyError::Fatal("Ya existe una carpeta con ese nombre (equipo local)".into()));
        }
    } else if let Some(parent) = local.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(lerr)?;
    }
    create_local_link(chan, remote, &target, local, dest.is_some()).await
}

#[cfg(unix)]
async fn create_local_link(_chan: &Chan, _remote: &str, target: &str, local: &Path, replace: bool) -> CopyResult<Outcome> {
    let lerr = |e: std::io::Error| CopyError::Fatal(local_io_message(&e));
    if replace {
        remove_link_or_file(local).await.map_err(lerr)?;
    }
    tokio::fs::symlink(target, local).await.map_err(lerr)?;
    Ok(Outcome::Copied(0))
}

/// Windows: crear enlaces simbólicos exige el Modo de desarrollador o permisos de administrador.
/// Si no se puede, el elemento se omite con un aviso (la transferencia sigue) y el archivo que
/// ocupara el nombre no se toca: el enlace se crea primero con un nombre temporal.
#[cfg(windows)]
async fn create_local_link(chan: &Chan, remote: &str, target: &str, local: &Path, replace: bool) -> CopyResult<Outcome> {
    // Objetivo absoluto del servidor (`/usr/…`): no existe en este equipo.
    if target.starts_with('/') {
        return Ok(Outcome::Skipped(
            "es un enlace simbólico a una ruta absoluta del servidor (no se puede recrear en Windows)".into(),
        ));
    }
    let win_target = target.replace('/', "\\");
    // Windows distingue enlaces a carpeta y a archivo: se mira a qué apunta en el servidor.
    let is_dir = chan
        .raw
        .stat(remote.to_string())
        .await
        .is_ok_and(|a| remote_kind(a.attrs.permissions) == RemoteKind::Dir);
    let tmp = if replace {
        let name = local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        local.with_file_name(format!(".{name}.sshorus-{}", uuid::Uuid::new_v4().simple()))
    } else {
        local.to_path_buf()
    };
    let made = if is_dir {
        tokio::fs::symlink_dir(&win_target, &tmp).await
    } else {
        tokio::fs::symlink_file(&win_target, &tmp).await
    };
    if let Err(e) = made {
        // ERROR_PRIVILEGE_NOT_HELD (1314) o acceso denegado: sin permiso para crear enlaces.
        if e.raw_os_error() == Some(1314) || e.kind() == std::io::ErrorKind::PermissionDenied {
            return Ok(Outcome::Skipped(
                "es un enlace simbólico y Windows no permite crearlo sin el Modo de desarrollador o \
                 permisos de administrador"
                    .into(),
            ));
        }
        return Err(CopyError::Fatal(local_io_message(&e)));
    }
    if replace {
        let lerr = |e: std::io::Error| CopyError::Fatal(local_io_message(&e));
        if let Err(e) = remove_link_or_file(local).await {
            let _ = remove_link_or_file(&tmp).await;
            return Err(lerr(e));
        }
        if let Err(e) = tokio::fs::rename(&tmp, local).await {
            let _ = remove_link_or_file(&tmp).await;
            return Err(lerr(e));
        }
    }
    Ok(Outcome::Copied(0))
}

/// Borra un archivo o enlace simbólico local. En Windows los enlaces a carpeta se borran con
/// `remove_dir` (sin tocar lo que hay dentro del objetivo); `remove_file` fallaría.
pub(super) async fn remove_link_or_file(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        if let Ok(m) = tokio::fs::symlink_metadata(path).await
            && m.file_type().is_symlink_dir()
        {
            return tokio::fs::remove_dir(path).await;
        }
    }
    tokio::fs::remove_file(path).await
}

#[cfg(not(any(unix, windows)))]
async fn create_local_link(_chan: &Chan, _remote: &str, _target: &str, _local: &Path, _replace: bool) -> CopyResult<Outcome> {
    Ok(Outcome::Skipped("es un enlace simbólico (no admitido en este sistema)".into()))
}
