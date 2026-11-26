//! Explorador de archivos (SFTP) y transferencias.

use serde::{Deserialize, Serialize};

// ───────────────────────── SFTP ─────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Ruta absoluta en el servidor.
    pub path: String,
    pub kind: FileKind,
    /// Si es symlink: true si apunta a una carpeta.
    pub is_dir_link: bool,
    pub size: u64,
    /// Unix segundos.
    pub modified: Option<u64>,
    /// Bits de permisos (p. ej. 0o755).
    pub permissions: Option<u32>,
    /// "drwxr-xr-x"
    pub permissions_str: String,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteText {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub modified: Option<u64>,
}

// ───────────────────────── Transferencias ─────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Queued,
    Running,
    Paused,
    Done,
    /// No se transfirió por la política de conflictos (ya existía / no era más nuevo).
    Skipped,
    Error,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJob {
    pub id: String,
    /// Todos los archivos de una misma acción (p. ej. arrastrar una carpeta) comparten batch.
    pub batch_id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    /// Nombre a mostrar (ruta relativa dentro del lote, p. ej. "fotos/viaje/a.jpg").
    pub name: String,
    pub size: u64,
    pub transferred: u64,
    pub status: TransferStatus,
    pub error: Option<String>,
    /// Bytes por segundo (media reciente).
    pub speed: f64,
    /// Unix ms
    pub created_at: u64,
    pub finished_at: Option<u64>,
}
