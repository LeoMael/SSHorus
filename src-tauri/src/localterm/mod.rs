//! Terminal local: pestañas con una shell **del propio equipo** (no de un servidor), y lanzar
//! asistentes de IA (Claude Code, Codex, Antigravity/agy, OpenCode) con el contexto de SSHorus y,
//! en los que lo admiten, su MCP ya configurado.
//!
//! Igual que las terminales SSH: la salida llega por el `Channel` de `local_term_open` (bytes
//! crudos) y, al terminar, se emite `EV_TERMINAL_EXIT` con el id. Así la interfaz usa la misma vista.
//!
//! Lo que SSHorus NUNCA hace aquí: leer o copiar la configuración de los asistentes (`~/.claude`,
//! `~/.codex`, `~/.gemini`, `~/.config/opencode`…), escribir archivos en la carpeta del usuario,
//! ni poner el token del MCP en un archivo o en los argumentos (va por variable de entorno al
//! proceso hijo).
//!
//! Archivos: `tools` (los asistentes, como datos) · `aicli` (dónde están) · `args` (con qué
//! argumentos se abren) · `launch` (MCP, contexto y comando final) · `env` (entorno del proceso) ·
//! `pty` (la terminal) · `open` (abrir una terminal y detectar asistentes) · `state` (carpeta actual
//! de la shell) · `aliases` (alias de `~/.ssh/config`) · `commands` (comandos Tauri).

pub mod aicli;
pub mod aliases;
pub mod args;
pub mod commands;
pub mod env;
pub mod launch;
pub mod open;
pub mod pty;
pub mod state;
pub mod tools;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use pty::LocalPty;
use tools::AiTool;

// ───────────────────────── Ajustes ─────────────────────────

/// Ajustes de la terminal local y de los asistentes (Ajustes → Terminal local e IA).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalAiSettings {
    /// Cómo trabaja el asistente con los servidores: "both" | "direct" (ssh) | "mcp".
    pub mode: String,
    /// Incluir la lista de servidores (nombre, alias, usuario…).
    pub include_servers: bool,
    /// Incluir host y puerto de cada servidor.
    pub include_hosts: bool,
    /// Incluir los proyectos.
    pub include_projects: bool,
    /// Incluir la pestaña que se estaba mirando.
    pub include_active: bool,
    /// Incluir la fecha.
    pub include_date: bool,
    /// Última carpeta elegida para abrir terminales locales (None = carpeta personal).
    pub last_cwd: Option<String>,
}

impl Default for LocalAiSettings {
    fn default() -> Self {
        LocalAiSettings {
            mode: "both".into(),
            include_servers: true,
            include_hosts: true,
            include_projects: true,
            include_active: true,
            include_date: true,
            last_cwd: None,
        }
    }
}

impl LocalAiSettings {
    pub fn sanitized(mut self) -> Self {
        if !matches!(self.mode.as_str(), "both" | "direct" | "mcp") {
            self.mode = "both".into();
        }
        if self.last_cwd.as_deref().is_some_and(|c| c.trim().is_empty()) {
            self.last_cwd = None;
        }
        self
    }
}

// ───────────────────────── Estado ─────────────────────────

/// Terminales locales abiertas: termId → PTY.
#[derive(Default)]
pub struct LocalTermStore {
    terms: Mutex<HashMap<String, LocalPty>>,
}

impl LocalTermStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, LocalPty>> {
        self.terms.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, id: &str) -> AppResult<LocalPty> {
        self.lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))
    }

    pub fn write(&self, id: &str, data: Vec<u8>) -> AppResult<()> {
        self.get(id)?.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        self.get(id)?.resize(cols, rows)
    }

    /// Cierra la terminal: termina el programa y todo lo que lanzó.
    pub fn close(&self, id: &str) -> AppResult<()> {
        match self.lock().remove(id) {
            Some(t) => {
                t.close();
                Ok(())
            }
            None => Err(AppError::NotFound(format!("terminal {id}"))),
        }
    }

    /// Cierra todas (al cerrar la app).
    pub fn close_all(&self) {
        for (_, t) in self.lock().drain() {
            t.close();
        }
    }
}

// ───────────────────────── Tipos de la interfaz ─────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTermInfo {
    pub home: String,
    /// Shell que se abre por defecto.
    pub shell: String,
    /// "linux" | "mac" | "windows"
    pub os: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolInfo {
    pub tool: AiTool,
    pub label: String,
    pub installed: bool,
    pub path: Option<String>,
    /// Comando oficial para instalarlo en este sistema.
    pub install_command: String,
    /// Hace falta Node.js (npm) para instalarlo.
    pub needs_node: bool,
    /// Hay npm (para el aviso «falta Node.js»).
    pub npm_found: bool,
    /// Se le puede configurar el MCP de SSHorus sin tocar sus archivos.
    pub supports_mcp: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLaunch {
    pub tool: AiTool,
    /// Contexto de SSHorus (lo arma la interfaz; nunca lleva secretos).
    pub context: Option<String>,
    /// Configurar el MCP de SSHorus.
    pub mcp: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOpen {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Sin esto se abre la shell.
    pub launch: Option<AiLaunch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOpened {
    pub term_id: String,
    pub cwd: String,
    /// Programa que corre (ruta).
    pub program: String,
    /// El asistente se abrió con el MCP de SSHorus.
    pub mcp: bool,
    /// Algo no salió como se pidió (p. ej. el MCP está apagado y se abrió solo con el contexto).
    pub warning: Option<String>,
}
