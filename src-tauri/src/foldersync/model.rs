//! Tipos de «Sincronizar carpeta» que viajan a la interfaz (espejo en `src/api/folderSync.ts`).

use serde::{Deserialize, Serialize};

/// Lo que elige el usuario al unir una carpeta de su PC con una del servidor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSpec {
    pub local_dir: String,
    pub remote_dir: String,
    /// Patrones a ignorar además de los fijos y de `.sshorusignore` (uno por línea).
    #[serde(default)]
    pub ignore: Vec<String>,
    /// Borrar en el servidor lo que se borra en el PC (apagado por defecto).
    #[serde(default)]
    pub delete_remote: bool,
}

/// Una sincronización guardada para reactivarla al volver a conectar (`folder_syncs.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSync {
    /// Id del servidor guardado.
    pub server_id: String,
    #[serde(flatten)]
    pub spec: SyncSpec,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    /// Todo lo guardado ya está en el servidor.
    Idle,
    /// Hay cambios esperando a que el PC deje de escribir o subiéndose.
    Uploading,
    Paused,
    /// La conexión se está recuperando: los cambios esperan.
    Waiting,
    Error,
}

/// Estado de una sincronización activa (evento `EV_FOLDER_SYNC` con la lista entera).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncInfo {
    pub id: String,
    pub session_id: String,
    pub spec: SyncSpec,
    pub state: SyncState,
    /// Archivos pendientes de subir (esperando o en marcha).
    pub pending: u32,
    /// Archivos que se vigilan.
    pub files: u32,
    pub last_file: Option<String>,
    /// Unix ms de la última subida terminada.
    pub last_at: Option<u64>,
    pub error: Option<String>,
    /// Aviso que no para la sincronización (carpeta enorme, borrados masivos no aplicados…).
    pub warning: Option<String>,
    /// Se guardó para reactivarla al reconectar.
    pub remembered: bool,
}

/// Un archivo de la comparación inicial. Fechas en segundos Unix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    /// Ruta relativa con `/`.
    pub rel: String,
    pub size: u64,
    pub local_mtime: u64,
    pub remote_mtime: Option<u64>,
}

/// Vista previa de la comparación inicial (nada se sube todavía).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPreview {
    pub local_files: u32,
    /// Faltan en el servidor o la copia de tu PC es más nueva.
    pub to_upload: Vec<PlanItem>,
    pub upload_bytes: u64,
    /// En el servidor son más nuevos: no se pisan sin preguntar.
    pub remote_newer: Vec<PlanItem>,
    /// Iguales en los dos sitios.
    pub same: u32,
    /// La carpeta tiene más archivos de los que se vigilan.
    pub truncated: bool,
}
