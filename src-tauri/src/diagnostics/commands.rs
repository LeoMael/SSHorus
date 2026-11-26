//! Comando Tauri del panel de diagnóstico.

use super::AppDiagnostics;

#[tauri::command]
pub fn app_diagnostics() -> AppDiagnostics {
    super::collect()
}
