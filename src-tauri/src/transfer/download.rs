//! Bajada de un archivo por SFTP con lecturas encadenadas y escritor de disco en hilo aparte.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use futures::stream::{FuturesOrdered, StreamExt};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::{FileAttributes, OpenFlags, StatusCode};
use tokio::sync::mpsc;

use super::copy::{local_err, or_stop, send_now, sftp_err, CopyError, CopyResult, Ctrl, Op};
use super::pool::Chan;

/// Baja `remote` → `local` empezando en `offset`. `size` es el tamaño conocido del remoto.
#[allow(clippy::too_many_arguments)]
pub async fn download_file(
    chan: &Chan,
    remote: &str,
    local: &Path,
    offset: u64,
    size: u64,
    mode: Option<u32>,
    mtime: Option<u32>,
    ctrl: &Ctrl,
) -> CopyResult<u64> {
    let raw = &chan.raw;
    let handle = or_stop(
        &ctrl.token,
        raw.open(remote.to_string(), OpenFlags::READ, FileAttributes::empty()),
    )
    .await?
    .map_err(sftp_err)?
    .handle;

    let result = download_body(chan, &handle, local, offset, size, ctrl).await;
    if result.is_err() {
        drop(send_now(Box::pin(raw.close(handle))));
        return result;
    }
    // Fecha y bit de ejecución (lo demás queda con los permisos por defecto del usuario).
    let path = local.to_path_buf();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&path) {
            if let Some(m) = mtime {
                let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(m as u64);
                let _ = f.set_modified(t);
            }
            #[cfg(unix)]
            if let Some(mode) = mode
                && mode & 0o111 != 0
                && let Ok(meta) = f.metadata()
            {
                use std::os::unix::fs::PermissionsExt;
                let cur = meta.permissions().mode();
                let _ = f.set_permissions(std::fs::Permissions::from_mode(cur | (mode & 0o111)));
            }
        }
        #[cfg(not(unix))]
        let _ = mode;
    })
    .await;
    result
}

async fn download_body(
    chan: &Chan,
    handle: &str,
    local: &Path,
    offset: u64,
    size: u64,
    ctrl: &Ctrl,
) -> CopyResult<u64> {
    let raw = &chan.raw;
    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true).create(true);
    if offset == 0 {
        opts.truncate(true);
    }
    let file = match opts.open(local).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = local.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(local_err)?;
            }
            opts.open(local).await.map_err(local_err)?
        }
        Err(e) => return Err(local_err(e)),
    };
    ctrl.touched.store(true, Ordering::Relaxed);

    // Escritor de disco en un hilo aparte: la red no espera al disco.
    let written = Arc::new(AtomicU64::new(offset));
    let (wtx, mut wrx) = mpsc::channel::<Vec<u8>>(16);
    let mut std_file = file.into_std().await;
    let w = written.clone();
    let writer = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::{Seek, Write};
        if offset > 0 {
            std_file.set_len(offset)?;
            std_file.seek(std::io::SeekFrom::Start(offset))?;
        }
        while let Some(buf) = wrx.blocking_recv() {
            std_file.write_all(&buf)?;
            w.fetch_add(buf.len() as u64, Ordering::Relaxed);
        }
        std_file.flush()
    });

    let chunk = chan.read_chunk as u64;
    let depth = Chan::depth(chan.read_chunk);
    type ReadOut = (u64, u64, Result<Vec<u8>, SftpError>);
    let mut inflight: FuturesOrdered<Op<'_, ReadOut>> = FuturesOrdered::new();
    let mut next = offset;
    let mut close: Option<Op<'_, Result<(), SftpError>>> = None;

    let outcome: CopyResult<()> = loop {
        while close.is_none() && inflight.len() < depth && next < size {
            let len = chunk.min(size - next);
            let at = next;
            next += len;
            let h = handle.to_string();
            inflight.push_back(send_now(Box::pin(async move {
                let r = raw.read(h, at, len as u32).await.map(|d| d.data);
                (at, len, r)
            })));
        }
        if close.is_none() && next >= size {
            let h = handle.to_string();
            close = Some(send_now(Box::pin(async move { raw.close(h).await.map(|_| ()) })));
        }
        if inflight.is_empty() {
            break Ok(());
        }
        let item = tokio::select! {
            biased;
            _ = ctrl.token.cancelled() => break Err(CopyError::Stopped),
            Some(item) = inflight.next() => item,
        };
        ctrl.progress.store(written.load(Ordering::Relaxed), Ordering::Relaxed);
        let (at, len, res) = item;
        match res {
            Ok(data) if data.is_empty() => break Ok(()),
            Ok(data) => {
                let n = data.len() as u64;
                if wtx.send(data).await.is_err() {
                    break Ok(());
                }
                if n < len {
                    if close.is_some() {
                        break Err(CopyError::Transient("Lectura incompleta del servidor".into()));
                    }
                    inflight = FuturesOrdered::new();
                    next = at + n;
                }
            }
            Err(SftpError::Status(s)) if s.status_code == StatusCode::Eof => break Ok(()),
            Err(e) => break Err(sftp_err(e)),
        }
    };
    drop(wtx);
    let wres = writer.await;
    let done = written.load(Ordering::Relaxed);
    ctrl.progress.store(done, Ordering::Relaxed);
    let outcome = match (outcome, wres) {
        (Err(e), _) => Err(e),
        (Ok(()), Ok(Ok(()))) => Ok(done),
        (Ok(()), Ok(Err(e))) => Err(local_err(e)),
        (Ok(()), Err(_)) => Err(CopyError::Fatal("Falló la escritura en disco".into())),
    };
    if outcome.is_ok()
        && let Some(c) = close
    {
        let _ = or_stop(&ctrl.token, c).await;
    }
    outcome
}
