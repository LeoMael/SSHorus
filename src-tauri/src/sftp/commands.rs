//! Comandos Tauri del explorador y del editor remoto: sacan la conexión y llaman a `SftpStore`.

use std::sync::Arc;

use tauri::State;

use super::SftpStore;
use crate::error::AppResult;
use crate::ssh::{SessionStore, SshSession};
use crate::types::{FileEntry, RemoteText};

/// Obtiene la conexión SSH; si ya no existe, olvida sus canales SFTP.
async fn ssh_for(sessions: &SessionStore, sftp: &SftpStore, id: &str) -> AppResult<Arc<SshSession>> {
    match sessions.get(id).await {
        Ok(s) => Ok(s),
        Err(e) => {
            sftp.forget(id);
            Err(e)
        }
    }
}

/// Ruta absoluta del home del usuario remoto.
#[tauri::command]
pub async fn sftp_home(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String) -> AppResult<String> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.home(&ssh).await
}

/// Lista una carpeta (sin "." ni ".."), carpetas primero y luego por nombre.
#[tauri::command]
pub async fn sftp_list_dir(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String) -> AppResult<Vec<FileEntry>> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.list_dir(&ssh, &path).await
}

#[tauri::command]
pub async fn sftp_stat(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String) -> AppResult<FileEntry> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.stat(&ssh, &path).await
}

#[tauri::command]
pub async fn sftp_mkdir(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String) -> AppResult<()> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.mkdir(&ssh, &path).await
}

/// Crea un archivo vacío (falla si ya existe).
#[tauri::command]
pub async fn sftp_create_file(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String) -> AppResult<()> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.create_file(&ssh, &path).await
}

#[tauri::command]
pub async fn sftp_rename(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, from: String, to: String) -> AppResult<()> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.rename(&ssh, &from, &to).await
}

/// Borra archivos y carpetas (recursivo).
#[tauri::command]
pub async fn sftp_delete(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, paths: Vec<String>) -> AppResult<()> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.delete(&ssh, &paths).await
}

#[tauri::command]
pub async fn sftp_chmod(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String, mode: u32) -> AppResult<()> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.chmod(&ssh, &path, mode).await
}

/// Lee un archivo de texto para el editor. Error FileTooLarge si supera `Settings.editor_max_bytes`.
#[tauri::command]
pub async fn sftp_read_text(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, settings: State<'_, crate::storage::SettingsStore>, session_id: String, path: String) -> AppResult<RemoteText> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    let max = settings.get().editor_max_bytes;
    sftp.read_text(&ssh, &path, max).await
}

/// Guarda de forma atómica (temporal + renombrar) conservando permisos. Devuelve el nuevo estado.
#[tauri::command]
pub async fn sftp_write_text(sessions: State<'_, SessionStore>, sftp: State<'_, SftpStore>, session_id: String, path: String, content: String) -> AppResult<FileEntry> {
    let ssh = ssh_for(&sessions, &sftp, &session_id).await?;
    sftp.write_text(&ssh, &path, &content).await
}
