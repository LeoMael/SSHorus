//! El arrastre directo en el panel de Transferencias: cada archivo que el sistema empieza a leer
//! aparece como una descarga más (los mismos eventos que el motor de transferencias), aunque no
//! pase por su cola. Se puede cancelar y limpiar desde el panel; pausar y reintentar, no (lo
//! decide el sistema que copia).

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::runtime::Handle;
use tokio_util::sync::CancellationToken;

use crate::types::{TransferDirection, TransferJob, TransferStatus};

/// Cada cuánto se avisa del progreso (como el motor de transferencias).
const TICK: Duration = Duration::from_millis(200);
/// Lo que se ve como "destino" en el panel (no se sabe la carpeta: la elige el sistema).
pub const DEST_LABEL: &str = "Arrastre directo (donde se soltó)";

const RUNNING: u8 = 0;
const DONE: u8 = 1;
const ERROR: u8 = 2;
const CANCELED: u8 = 3;

/// A dónde van los avisos (eventos de Tauri en la app; una lista en las pruebas).
pub trait JobSink: Send + Sync {
    fn update(&self, jobs: Vec<TransferJob>);
    fn removed(&self, ids: Vec<String>);
}

/// Progreso de un archivo, compartido con su lector.
pub struct FileProgress {
    pub token: CancellationToken,
    size: u64,
    reached: AtomicU64,
    state: AtomicU8,
    error: Mutex<Option<String>>,
}

impl FileProgress {
    fn new(size: u64) -> Self {
        Self { token: CancellationToken::new(), size, reached: AtomicU64::new(0), state: AtomicU8::new(RUNNING), error: Mutex::new(None) }
    }

    /// Se leyó hasta `pos` (si el sistema vuelve atrás no cuenta dos veces). Leído entero =
    /// terminado, aunque el sistema aún no haya soltado el flujo.
    pub fn reach(&self, pos: u64) {
        self.reached.fetch_max(pos, Ordering::Relaxed);
        if pos >= self.size {
            self.settle(DONE);
        }
    }

    pub fn fail(&self, msg: String) {
        if self.settle(ERROR) {
            *lock(&self.error) = Some(msg);
        }
    }

    pub fn cancel(&self) {
        self.settle(CANCELED);
        self.token.cancel();
    }

    /// El sistema soltó el archivo: terminado si lo leyó entero, cancelado si no.
    pub fn finish(&self) {
        self.settle(if self.reached() >= self.size { DONE } else { CANCELED });
    }

    pub fn reached(&self) -> u64 {
        self.reached.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> TransferStatus {
        match self.state.load(Ordering::Acquire) {
            RUNNING => TransferStatus::Running,
            DONE => TransferStatus::Done,
            ERROR => TransferStatus::Error,
            _ => TransferStatus::Canceled,
        }
    }

    /// Pasa de "en marcha" a `to`; `false` si ya había terminado.
    fn settle(&self, to: u8) -> bool {
        self.state.compare_exchange(RUNNING, to, Ordering::AcqRel, Ordering::Acquire).is_ok()
    }
}

struct Tracked {
    job: TransferJob,
    progress: Arc<FileProgress>,
    last_ms: u64,
    /// Aún no se avisó de que existe.
    fresh: bool,
}

#[derive(Default)]
struct Inner {
    jobs: Vec<Tracked>,
    ticking: bool,
}

/// Archivos del arrastre directo que se ven en el panel.
pub struct Jobs {
    rt: Handle,
    sink: Arc<dyn JobSink>,
    inner: Mutex<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Jobs {
    pub fn new(rt: Handle, sink: Arc<dyn JobSink>) -> Arc<Self> {
        Arc::new(Self { rt, sink, inner: Mutex::default() })
    }

    /// Un archivo empieza a copiarse. Se puede llamar desde cualquier hilo (también fuera de tokio):
    /// el aviso lo da el contador en tokio, no el hilo del sistema que pide el archivo.
    pub fn add(self: &Arc<Self>, batch_id: &str, session_id: &str, name: &str, remote: &str, size: u64) -> Arc<FileProgress> {
        let progress = Arc::new(FileProgress::new(size));
        let now = now_ms();
        let job = TransferJob {
            id: uuid::Uuid::new_v4().to_string(),
            batch_id: batch_id.to_string(),
            session_id: session_id.to_string(),
            direction: TransferDirection::Download,
            local_path: DEST_LABEL.to_string(),
            remote_path: remote.to_string(),
            name: name.to_string(),
            size,
            transferred: 0,
            status: TransferStatus::Running,
            error: None,
            speed: 0.0,
            created_at: now,
            finished_at: None,
        };
        let start_ticker = {
            let mut st = lock(&self.inner);
            st.jobs.push(Tracked { job, progress: progress.clone(), last_ms: now, fresh: true });
            !std::mem::replace(&mut st.ticking, true)
        };
        if start_ticker {
            let me = self.clone();
            self.rt.spawn(async move {
                loop {
                    tokio::time::sleep(TICK).await;
                    if !me.tick(now_ms()) {
                        break;
                    }
                }
            });
        }
        progress
    }

    /// Avisa de lo que cambió desde la última vez. `false` (y deja de contar) si ya no queda
    /// nada en marcha.
    pub fn tick(&self, now: u64) -> bool {
        let (changed, running) = {
            let mut st = lock(&self.inner);
            let mut changed = Vec::new();
            for t in st.jobs.iter_mut() {
                if update(t, now) {
                    changed.push(t.job.clone());
                }
            }
            let running = st.jobs.iter().any(|t| t.job.status == TransferStatus::Running);
            if !running {
                st.ticking = false;
            }
            (changed, running)
        };
        if !changed.is_empty() {
            self.sink.update(changed);
        }
        running
    }

    /// Cancela trabajos o lotes (ids de cualquiera de los dos); los ids ajenos se ignoran.
    pub fn cancel(&self, ids: &[String]) {
        let st = lock(&self.inner);
        for t in st.jobs.iter().filter(|t| ids.contains(&t.job.id) || ids.contains(&t.job.batch_id)) {
            t.progress.cancel();
        }
    }

    /// Quita del panel los que ya terminaron.
    pub fn clear_finished(&self, now: u64) {
        let removed: Vec<String> = {
            let mut st = lock(&self.inner);
            for t in st.jobs.iter_mut() {
                update(t, now);
            }
            let (gone, keep): (Vec<Tracked>, Vec<Tracked>) =
                std::mem::take(&mut st.jobs).into_iter().partition(|t| t.job.status != TransferStatus::Running);
            st.jobs = keep;
            gone.into_iter().map(|t| t.job.id).collect()
        };
        if !removed.is_empty() {
            self.sink.removed(removed);
        }
    }
}

/// Copia el estado del lector al trabajo. `true` si cambió algo que se vea.
fn update(t: &mut Tracked, now: u64) -> bool {
    if t.job.status != TransferStatus::Running {
        return false;
    }
    let fresh = std::mem::take(&mut t.fresh);
    let reached = t.progress.reached();
    let status = t.progress.status();
    let moved = reached.saturating_sub(t.job.transferred);
    let dt = now.saturating_sub(t.last_ms);
    if moved == 0 && status == TransferStatus::Running {
        return fresh;
    }
    if dt > 0 {
        let inst = moved as f64 * 1000.0 / dt as f64;
        t.job.speed = if t.job.speed > 0.0 { t.job.speed * 0.7 + inst * 0.3 } else { inst };
    }
    t.last_ms = now;
    t.job.transferred = reached;
    t.job.status = status;
    if status != TransferStatus::Running {
        t.job.finished_at = Some(now);
        t.job.speed = 0.0;
        t.job.error = lock(&t.progress.error).clone();
    }
    true
}
