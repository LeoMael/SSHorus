//! Biblioteca de comandos y resultado de ejecutar un comando aparte.

use serde::{Deserialize, Serialize};

// ───────────────────────── Biblioteca de comandos ─────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SnippetScope {
    Global,
    Project,
    Server,
}

/// Comando guardado por el usuario ("Mis comandos"). Los del catálogo base viven en la interfaz.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    /// Vacío al crear; el motor asigna un UUID.
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Plantilla con variables `{{nombre}}` o `{{nombre:defecto}}`.
    pub command: String,
    /// Categoría libre (p. ej. "Podman", "Mis scripts").
    pub category: String,
    pub scope: SnippetScope,
    /// id de proyecto o servidor si scope != global.
    pub scope_id: Option<String>,
    pub dangerous: bool,
    pub sudo: bool,
    pub read_only: bool,
}

/// Resultado de ejecutar un comando aparte (canal exec).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub duration_ms: u64,
    /// true si la salida superó el límite y se recortó.
    pub truncated: bool,
    /// true si se cortó por tiempo.
    pub timed_out: bool,
}
