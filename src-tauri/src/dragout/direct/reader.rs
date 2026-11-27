//! Lector por trozos de un archivo remoto para el arrastre directo. El sistema (el Explorador
//! de Windows) lo lee de forma síncrona desde su hilo; cada lectura se hace en tokio y aquí se
//! espera la respuesta. El archivo se abre en la primera lectura (no al ofrecerlo).
//!
//! Cada lectura llena todo lo pedido (menos al final del archivo: así lo esperan los que leen un
//! `IStream`) y acaba con error si se cancela desde el panel o si el servidor no responde en
//! `READ_TIMEOUT`: el sistema lo muestra como una copia fallida.

use std::future::Future;
use std::io::{self, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures::future::BoxFuture;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};
use tokio::runtime::Handle;

use super::jobs::FileProgress;

/// Tiempo máximo para cada trozo de `PIECE` (≈ 9 KB/s como mínimo).
const READ_TIMEOUT: Duration = Duration::from_secs(120);
/// Una lectura del sistema se hace por trozos de este tamaño (cada uno con su tiempo límite).
pub const PIECE: usize = 1024 * 1024;
/// Posición desconocida del archivo abierto (una lectura se cortó a medias): hay que buscar.
const UNKNOWN: u64 = u64::MAX;

/// Abre el archivo (en tokio). En la app es `SftpSession::open`.
pub type Opener<R> = Box<dyn Fn() -> BoxFuture<'static, io::Result<R>> + Send + Sync>;
/// Da de alta el archivo en el panel. Se llama en la primera lectura: el sistema puede pedir
/// el flujo y soltarlo sin leer (no debe verse como una copia cancelada).
pub type Track = Box<dyn Fn() -> Arc<FileProgress> + Send + Sync>;

/// Resultado de una lectura.
#[derive(Debug, PartialEq, Eq)]
pub struct Chunk {
    pub len: usize,
    /// Se llegó al final del archivo.
    pub eof: bool,
}

struct Open<R> {
    file: Option<R>,
    /// Dónde está el archivo abierto (`UNKNOWN` tras un corte).
    at: u64,
}

pub struct BlockingReader<R: Send + 'static> {
    rt: Handle,
    open: Arc<tokio::sync::Mutex<Open<R>>>,
    opener: Arc<Opener<R>>,
    track: Track,
    progress: OnceLock<Arc<FileProgress>>,
    /// Posición pedida por el sistema (`Seek` solo la cambia; la siguiente lectura busca).
    pos: AtomicU64,
    size: u64,
}

impl<R: AsyncRead + AsyncSeek + Unpin + Send + 'static> BlockingReader<R> {
    pub fn new(rt: Handle, opener: Opener<R>, size: u64, track: Track) -> Self {
        Self {
            rt,
            open: Arc::new(tokio::sync::Mutex::new(Open { file: None, at: 0 })),
            opener: Arc::new(opener),
            track,
            progress: OnceLock::new(),
            pos: AtomicU64::new(0),
            size,
        }
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    fn progress(&self) -> &Arc<FileProgress> {
        self.progress.get_or_init(|| (self.track)())
    }

    /// Llena `buf` desde la posición actual (menos solo al final del archivo). Bloquea: no se
    /// debe llamar desde una tarea de tokio.
    pub fn read(&self, buf: &mut [u8]) -> io::Result<Chunk> {
        let mut len = 0;
        while len < buf.len() {
            let want = (buf.len() - len).min(PIECE);
            let (data, eof) = self.read_piece(want)?;
            buf[len..len + data.len()].copy_from_slice(&data);
            len += data.len();
            if eof {
                return Ok(Chunk { len, eof: true });
            }
        }
        Ok(Chunk { len, eof: false })
    }

    /// Un trozo de hasta `want` bytes; `true` si se llegó al final del archivo.
    fn read_piece(&self, want: usize) -> io::Result<(Vec<u8>, bool)> {
        let pos = self.pos.load(Ordering::Acquire);
        let open = self.open.clone();
        let opener = self.opener.clone();
        let r = self.run(async move {
            let mut st = open.lock().await;
            if st.file.is_none() {
                st.file = Some(opener().await?);
                st.at = 0;
            }
            let at = std::mem::replace(&mut st.at, UNKNOWN);
            let Some(file) = st.file.as_mut() else { return Err(io::Error::other("archivo no abierto")) };
            if at != pos {
                file.seek(SeekFrom::Start(pos)).await?;
            }
            let mut data = vec![0u8; want];
            let mut len = 0;
            let mut eof = false;
            while len < want {
                let n = file.read(&mut data[len..]).await?;
                if n == 0 {
                    eof = true;
                    break;
                }
                len += n;
            }
            data.truncate(len);
            st.at = pos + len as u64;
            Ok((data, eof))
        });
        match r {
            Ok(piece) => {
                let end = pos + piece.0.len() as u64;
                self.pos.store(end, Ordering::Release);
                self.progress().reach(end);
                Ok(piece)
            }
            Err(e) => {
                if e.kind() != io::ErrorKind::Interrupted {
                    self.progress().fail(e.to_string());
                }
                Err(e)
            }
        }
    }

    /// Cambia la posición (la siguiente lectura empieza ahí). Devuelve la nueva.
    pub fn seek(&self, to: SeekFrom) -> io::Result<u64> {
        let cur = self.pos.load(Ordering::Acquire);
        let new = match to {
            SeekFrom::Start(p) => Some(p),
            SeekFrom::Current(d) => cur.checked_add_signed(d),
            SeekFrom::End(d) => self.size.checked_add_signed(d),
        }
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "posición no válida"))?;
        self.pos.store(new, Ordering::Release);
        Ok(new)
    }

    /// Ejecuta `fut` en tokio y espera aquí el resultado (con cancelación y tiempo límite).
    fn run<T: Send + 'static>(&self, fut: impl Future<Output = io::Result<T>> + Send + 'static) -> io::Result<T> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let token = self.progress().token.clone();
        self.rt.spawn(async move {
            let r = tokio::select! {
                // Cancelar gana aunque la lectura ya esté lista.
                biased;
                _ = token.cancelled() => Err(io::Error::new(io::ErrorKind::Interrupted, "Cancelado")),
                r = tokio::time::timeout(READ_TIMEOUT, fut) => r.unwrap_or_else(|_| {
                    Err(io::Error::new(io::ErrorKind::TimedOut, "El servidor no responde"))
                }),
            };
            let _ = tx.send(r);
        });
        rx.recv().unwrap_or_else(|_| Err(io::Error::other("se cortó la lectura")))
    }
}

impl<R: Send + 'static> Drop for BlockingReader<R> {
    fn drop(&mut self) {
        if let Some(p) = self.progress.get() {
            p.finish();
        }
        // El archivo remoto se cierra en tokio (no en el hilo del sistema que suelta el flujo).
        let open = self.open.clone();
        self.rt.spawn(async move { drop(open) });
    }
}
