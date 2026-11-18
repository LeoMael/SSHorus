//! Un intento de copia con un canal ya prestado (incluye la política de conflictos).

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::super::copy::{self, CopyError, CopyResult, Ctrl};
use super::super::paths::{local_io_message, numbered_name, remote_basename, remote_join, remote_parent, renamed_display};
use super::super::policy::{decide, Conflict, ConflictQuestion, Decision};
use super::super::pool::Chan;
use super::links::{download_link, local_dest, remote_dest, remove_link_or_file, upload_link};
use super::state::{Kind, Outcome};
use crate::types::{TransferDirection, TransferJob};

/// Un intento con un canal ya prestado. Con "mantener ambos" cambia el destino de `job`.
#[allow(clippy::too_many_arguments)]
pub(super) async fn try_once(
    job: &mut TransferJob,
    kind: &Kind,
    policy: Conflict,
    check: &mut bool,
    verify: bool,
    chan: &Chan,
    ctrl: &Ctrl,
) -> CopyResult<Outcome> {
    let up = job.direction == TransferDirection::Upload;
    let is_link = matches!(kind, Kind::Link { .. });
    let (mode, mtime) = match kind {
        Kind::File { mode, mtime } => (*mode, *mtime),
        Kind::Link { mtime, .. } => (None, *mtime),
        _ => return Err(CopyError::Fatal("No reintentable".into())),
    };

    if *check {
        let local = Path::new(&job.local_path);
        let (src_mtime, dest) = if up {
            let meta = if is_link {
                tokio::fs::symlink_metadata(local).await
            } else {
                tokio::fs::metadata(local).await
            };
            (copy::unix_secs_u64(meta.and_then(|m| m.modified())), remote_dest(chan, &job.remote_path).await?)
        } else {
            (mtime.map(u64::from), local_dest(local).await?)
        };
        match decide(policy, src_mtime, dest.map(|d| d.mtime)) {
            Decision::Transfer => {}
            Decision::Skip(why) => return Ok(Outcome::Skipped(why.into())),
            Decision::Ask => {
                let dest = dest.unwrap_or_default();
                let (source, destination) = if up {
                    (job.local_path.clone(), job.remote_path.clone())
                } else {
                    (job.remote_path.clone(), job.local_path.clone())
                };
                return Ok(Outcome::Ask(Box::new(ConflictQuestion {
                    job_id: job.id.clone(),
                    batch_id: job.batch_id.clone(),
                    session_id: job.session_id.clone(),
                    direction: job.direction,
                    name: job.name.clone(),
                    source,
                    destination,
                    source_size: (!is_link).then_some(job.size),
                    source_mtime: src_mtime,
                    dest_size: dest.size,
                    dest_mtime: dest.mtime,
                    is_link,
                })));
            }
            Decision::Rename => rename_destination(job, chan, up).await?,
        }
        // Bajada de un archivo: si el nombre lo ocupa un enlace simbólico local, se reemplaza
        // el enlace (nunca se escribe a través de él).
        let local = Path::new(&job.local_path);
        if !up
            && !is_link
            && let Ok(m) = tokio::fs::symlink_metadata(local).await
            && m.file_type().is_symlink()
        {
            remove_link_or_file(local)
                .await
                .map_err(|e| CopyError::Fatal(local_io_message(&e)))?;
        }
        *check = false;
    }

    let local = Path::new(&job.local_path);
    if let Kind::Link { target, .. } = kind {
        return if up {
            upload_link(chan, &job.remote_path, target.as_deref()).await
        } else {
            download_link(chan, &job.remote_path, local).await
        };
    }

    let mut offset = ctrl.progress.load(Ordering::Relaxed);
    if verify && offset > 0 {
        // Se continúa solo si el destino tiene al menos lo ya confirmado.
        let dest = if up {
            copy::remote_size(chan, &job.remote_path).await
        } else {
            copy::local_size(local).await
        };
        if dest.is_none_or(|s| s < offset) {
            offset = 0;
            ctrl.progress.store(0, Ordering::Relaxed);
        }
    }
    let n = if up {
        copy::upload_file(chan, local, &job.remote_path, offset, ctrl).await?
    } else {
        copy::download_file(chan, &job.remote_path, local, offset, job.size, mode, mtime, ctrl).await?
    };
    Ok(Outcome::Copied(n))
}

/// Primer nombre libre `nombre (N).ext` junto al destino ("mantener ambos"); actualiza la
/// ruta de destino y el nombre a mostrar del trabajo.
async fn rename_destination(job: &mut TransferJob, chan: &Chan, up: bool) -> CopyResult<()> {
    const MAX_TRIES: usize = 10_000;
    if up {
        let parent = remote_parent(&job.remote_path);
        let base = remote_basename(&job.remote_path);
        for n in 2..MAX_TRIES {
            let name = numbered_name(&base, n);
            let cand = remote_join(&parent, &name);
            if remote_dest(chan, &cand).await?.is_none() {
                job.remote_path = cand;
                job.name = renamed_display(&job.name, &name);
                return Ok(());
            }
        }
    } else {
        let local = PathBuf::from(&job.local_path);
        let base = local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        for n in 2..MAX_TRIES {
            let name = numbered_name(&base, n);
            let cand = local.with_file_name(&name);
            if local_dest(&cand).await?.is_none() {
                job.local_path = cand.to_string_lossy().into_owned();
                job.name = renamed_display(&job.name, &name);
                return Ok(());
            }
        }
    }
    Err(CopyError::Fatal("No se encontró un nombre libre para mantener ambos archivos".into()))
}
