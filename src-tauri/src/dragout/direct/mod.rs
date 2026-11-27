//! Arrastre directo (experimental, apagado por defecto; Ajustes → Transferencias): en vez de
//! descargar a la caché y que el sistema copie desde ahí, se ofrecen «archivos virtuales» y el
//! sistema los lee por SFTP al soltar (cada byte pasa una sola vez).
//!
//! - Windows (`win/`): `CFSTR_FILEDESCRIPTORW` (lista de nombres, tamaños y carpetas) +
//!   `CFSTR_FILECONTENTS` con un `IStream` por archivo que lee por SFTP bajo demanda.
//! - macOS (`NSFilePromiseProvider`): pendiente, hace falta `objc2`/`objc2-app-kit` como
//!   dependencias directas (ver docs/PENDIENTES.md).
//! - Linux: no hay equivalente estándar (Wayland solo acepta rutas que ya existan).
//!
//! Lo común (y probado en Linux): `list` (qué se ofrece), `reader` (lectura por trozos con
//! cancelación) y `jobs` (progreso en el panel de Transferencias). Si algo falla antes de
//! empezar, la interfaz vuelve sola al arrastre de siempre.

// La lectura y la lista solo las usa Windows; en los demás sistemas las usan las pruebas.
#![cfg_attr(not(windows), allow(dead_code))]

pub mod jobs;
pub mod list;
pub mod reader;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_sftp;
#[cfg(windows)]
mod win;

use std::sync::{Arc, OnceLock};

use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::types::{TransferJob, EV_TRANSFER_REMOVED, EV_TRANSFER_UPDATE};
use jobs::{JobSink, Jobs};
use list::VirtualEntry;

static JOBS: OnceLock<Arc<Jobs>> = OnceLock::new();

struct TauriSink(AppHandle);

impl JobSink for TauriSink {
    fn update(&self, jobs: Vec<TransferJob>) {
        if let Err(e) = self.0.emit(EV_TRANSFER_UPDATE, jobs) {
            log::warn!("arrastre directo: no se pudo emitir progreso: {e}");
        }
    }
    fn removed(&self, ids: Vec<String>) {
        if let Err(e) = self.0.emit(EV_TRANSFER_REMOVED, ids) {
            log::warn!("arrastre directo: no se pudo emitir limpieza: {e}");
        }
    }
}

/// Llamar desde tokio (la primera vez guarda su `Handle`).
fn jobs(app: &AppHandle) -> Arc<Jobs> {
    JOBS.get_or_init(|| Jobs::new(tokio::runtime::Handle::current(), Arc::new(TauriSink(app.clone()))))
        .clone()
}

/// Cancelar desde el panel (lo llama `transfer_cancel`; los ids ajenos se ignoran).
pub fn cancel(ids: &[String]) {
    if let Some(j) = JOBS.get() {
        j.cancel(ids);
    }
}

/// «Limpiar terminadas» del panel (lo llama `transfer_clear_finished`).
pub fn clear_finished() {
    if let Some(j) = JOBS.get() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        j.clear_finished(now);
    }
}

/// Lo que se ofrece al sistema en un arrastre: la lista y cómo leer cada archivo.
pub struct DirectSet {
    pub entries: Vec<VirtualEntry>,
    rt: tokio::runtime::Handle,
    sftp: Arc<SftpSession>,
    jobs: Arc<Jobs>,
    batch_id: String,
    session_id: String,
}

impl DirectSet {
    /// Lector del elemento `i` (se ve en el panel desde su primera lectura). `None` si no es un archivo.
    pub fn reader(&self, i: usize) -> Option<reader::BlockingReader<russh_sftp::client::fs::File>> {
        let e = self.entries.get(i).filter(|e| !e.is_dir)?;
        let (jobs, batch, session) = (self.jobs.clone(), self.batch_id.clone(), self.session_id.clone());
        let (name, remote, size) = (e.rel.replace('\\', "/"), e.remote.clone(), e.size);
        let track: reader::Track = Box::new(move || jobs.add(&batch, &session, &name, &remote, size));
        let sftp = self.sftp.clone();
        let remote = e.remote.clone();
        let opener: reader::Opener<_> = Box::new(move || {
            let sftp = sftp.clone();
            let remote = remote.clone();
            Box::pin(async move { sftp.open(remote).await.map_err(std::io::Error::other) })
        });
        Some(reader::BlockingReader::new(self.rt.clone(), opener, e.size, track))
    }
}

impl Drop for DirectSet {
    fn drop(&mut self) {
        // El canal SFTP se cierra en tokio, no en el hilo del sistema que suelta el arrastre.
        let sftp = self.sftp.clone();
        self.rt.spawn(async move { drop(sftp) });
    }
}

/// Prepara el arrastre directo de `paths` (rutas remotas completas) con un canal SFTP propio.
pub async fn prepare(app: &AppHandle, ssh: &crate::ssh::SshSession, session_id: &str, paths: &[String]) -> AppResult<DirectSet> {
    if !cfg!(windows) {
        return Err(AppError::Invalid("El arrastre directo solo está disponible en Windows".into()));
    }
    if paths.is_empty() {
        return Err(AppError::Invalid("No hay nada que arrastrar".into()));
    }
    let sftp = Arc::new(ssh.open_sftp().await?);
    let entries = list::collect(sftp.as_ref(), paths).await?;
    if entries.is_empty() {
        return Err(AppError::Invalid("No hay archivos ni carpetas que arrastrar".into()));
    }
    Ok(DirectSet {
        entries,
        rt: tokio::runtime::Handle::current(),
        sftp,
        jobs: jobs(app),
        batch_id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
    })
}

/// Arrastre nativo de `set`. Termina al soltar (y, en Windows, cuando el sistema acabó de
/// copiar): `true` si se soltó en algún sitio.
pub async fn drag(window: &WebviewWindow, set: DirectSet) -> AppResult<bool> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let done: super::Done = Box::new(move |r| {
        let _ = tx.send(r);
    });
    native_start(window, set, done)?;
    match rx.await {
        Ok(Ok(dropped)) => Ok(dropped),
        Ok(Err(msg)) => Err(AppError::Invalid(format!("No se pudo arrastrar: {msg}"))),
        Err(_) => Ok(false),
    }
}

#[cfg(windows)]
fn native_start(window: &WebviewWindow, set: DirectSet, done: super::Done) -> AppResult<()> {
    win::start(window, set, done)
}

#[cfg(not(windows))]
fn native_start(_window: &WebviewWindow, _set: DirectSet, _done: super::Done) -> AppResult<()> {
    Err(AppError::Invalid("El arrastre directo solo está disponible en Windows".into()))
}
