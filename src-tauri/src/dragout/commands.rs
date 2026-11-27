//! Comandos Tauri de arrastrar al escritorio: sacan la carpeta de caché (o la sesión) y llaman a la lógica.

use tauri::{AppHandle, State, WebviewWindow};

use super::{cache_root, check_paths, direct, drag, new_dir, DragOutDir};
use crate::error::AppResult;
use crate::ssh::SessionStore;

/// Crea una carpeta nueva y vacía en la caché para descargar ahí lo que se va a arrastrar.
/// Al ser nueva, la descarga nunca choca con archivos que ya existan (no pregunta "¿sobrescribir?").
#[tauri::command]
pub fn drag_out_dir(app: AppHandle) -> AppResult<DragOutDir> {
    new_dir(&cache_root(&app)?)
}

/// Empieza el arrastre nativo de archivos ya preparados (deben estar dentro de la caché de
/// arrastre). Hay que llamarlo con el botón del ratón apretado. Termina cuando el usuario suelta:
/// `true` si los soltó en algún sitio, `false` si canceló.
#[tauri::command]
pub async fn drag_out_start(app: AppHandle, window: WebviewWindow, paths: Vec<String>) -> AppResult<bool> {
    let root = cache_root(&app)?;
    let paths = check_paths(&root, &paths)?;
    drag(&window, paths).await
}

/// Arrastre directo (experimental, solo Windows): ofrece al sistema «archivos virtuales» de
/// `paths` (rutas remotas) que se leen por SFTP al soltar, sin pasar por la caché. Hay que
/// llamarlo con el botón apretado. Error si no se puede empezar: la interfaz vuelve al
/// arrastre de siempre.
#[tauri::command]
pub async fn drag_out_direct(
    app: AppHandle,
    window: WebviewWindow,
    sessions: State<'_, SessionStore>,
    session_id: String,
    paths: Vec<String>,
) -> AppResult<bool> {
    let ssh = sessions.get(&session_id).await?;
    let set = direct::prepare(&app, &ssh, &session_id, &paths).await?;
    direct::drag(&window, set).await
}
