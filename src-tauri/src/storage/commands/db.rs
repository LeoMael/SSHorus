//! Comandos Tauri de las credenciales de bases de datos: hacen la E/S fuera del hilo async y
//! llaman a `storage::db_secret`.

use super::super::db_secret::{self, DbCredential};
use super::super::blocking;
use crate::error::AppResult;

/// Destinos con credencial guardada (sin contraseñas), para marcar «guardada» y ofrecer «Olvidar».
#[tauri::command]
pub async fn db_creds_targets(profile_id: String) -> AppResult<Vec<String>> {
    blocking(move || db_secret::targets(&profile_id)).await
}

/// Credencial guardada de un destino (la usa la interfaz para conectar; nunca se muestra).
#[tauri::command]
pub async fn db_creds_get(profile_id: String, target: String) -> AppResult<Option<DbCredential>> {
    blocking(move || db_secret::get(&profile_id, &target)).await
}

/// Guarda (Some) u olvida (None) la credencial de un destino.
#[tauri::command]
pub async fn db_creds_set(profile_id: String, target: String, credential: Option<DbCredential>) -> AppResult<()> {
    blocking(move || db_secret::set(&profile_id, &target, credential)).await
}
