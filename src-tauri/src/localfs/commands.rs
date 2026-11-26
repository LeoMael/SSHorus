//! Comandos Tauri de archivos locales: validan la ruta y hacen la E/S fuera del hilo async.

use super::{check_path, read_text, write_bytes, write_text};
use crate::error::{AppError, AppResult};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}

/// Guarda texto en un archivo local (ruta completa, normalmente elegida con el diálogo «Guardar»).
#[tauri::command]
pub async fn local_write_text(path: String, content: String) -> AppResult<()> {
    let p = check_path(&path)?;
    blocking(move || write_text(&p, &content)).await
}

/// Guarda bytes (p. ej. una imagen PNG exportada) en un archivo local elegido con el diálogo «Guardar».
#[tauri::command]
pub async fn local_write_bytes(path: String, data: Vec<u8>) -> AppResult<()> {
    let p = check_path(&path)?;
    blocking(move || write_bytes(&p, &data)).await
}

/// Lee un archivo de texto local (ruta completa, normalmente elegida con el diálogo «Abrir»).
#[tauri::command]
pub async fn local_read_text(path: String) -> AppResult<String> {
    let p = check_path(&path)?;
    blocking(move || read_text(&p)).await
}
