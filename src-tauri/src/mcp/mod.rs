//! Servidor MCP de SSHorus: asistentes de IA (Claude Code, Claude Desktop…) trabajan con tus
//! servidores usando las conexiones guardadas, sin ver nunca contraseñas ni llaves.
//!
//! Piezas:
//! - `http`: transporte HTTP local (127.0.0.1 + token) con el SDK oficial `rmcp`.
//! - `server`: lista de herramientas y paso de cada llamada a `core`.
//! - `core`: permisos, aprobación, ejecución con límites y registro (sin Tauri: se prueba aparte).
//! - `policy`: reglas de acceso y comandos peligrosos. `config`: `mcp.json`. `audit`: registro.
//! - `grants`: casillas de «Solo lo marcado» y plantillas. `protect`: usuarios protegidos.
//!   `rules`: aplicar permisos a uno o varios servidores.
//! - `approval` y `ui`: diálogos y peticiones a la interfaz. `backend`: el motor de la app.
//! - `commands`: comandos Tauri expuestos a la interfaz.
//! - `server_audit`: resumen de las auditorías del servidor (`get_audit_report`, `run_audit`).
//! - `vuln`: resumen de los informes del escáner de vulnerabilidades para el asistente.
//! - `pty_run`, `prompt` y `redact`: `run_with_password` (escribir la contraseña en el terminal de un
//!   programa) y tapar contraseñas en lo que ve la IA.
//! - `bridge`: puente stdio (`sshorus-mcp`), compartido con `src/bin/sshorus-mcp.rs`.

pub mod approval;
pub mod audit;
pub mod backend;
#[allow(dead_code)] // el binario `sshorus-mcp` sí lo usa todo
pub mod bridge;
pub mod commands;
pub mod config;
pub mod core;
pub mod diff;
pub mod grants;
pub mod http;
pub mod local_guard;
pub mod policy;
pub mod prompt;
pub mod protect;
pub mod pty_run;
pub mod redact;
pub mod rules;
pub mod server;
pub mod server_audit;
pub use crate::snippets::sudo;
pub use commands::*;
pub mod template;
pub mod ui;
pub mod vuln;
#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::storage::secrets;
use crate::storage::vault::Vault;
use approval::PendingApprovals;
use audit::AuditLog;
use backend::TauriBackend;
use config::{McpConfig, McpConfigStore};
use ui::UiBridge;

/// Id del token en la bóveda o el llavero.
pub const TOKEN_ID: &str = secrets::MCP_TOKEN_USER;
/// Payload: `AuditEntry`. Una acción del asistente empezó, cambió o terminó.
pub const EV_ACTIVITY: &str = "mcp://activity";
/// Payload: `McpStatus`. El servidor se encendió, se apagó o falló.
pub const EV_STATUS: &str = "mcp://status";
/// Payload: `Vec<AutoState>`. Cambió el modo «Aceptar automáticamente» de algún servidor.
pub const EV_AUTO: &str = "mcp://auto";

/// Nombre del programa puente.
pub fn bridge_file_name() -> String {
    format!("sshorus-mcp{}", std::env::consts::EXE_SUFFIX)
}

/// Token nuevo: «tv_» + 64 caracteres hexadecimales (32 bytes al azar).
pub fn new_token() -> AppResult<Zeroizing<String>> {
    let mut b = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut b[..]).map_err(|e| AppError::Invalid(format!("no se pudo generar el token: {e}")))?;
    let mut s = Zeroizing::new(String::with_capacity(67));
    s.push_str("tv_");
    for byte in b.iter() {
        s.push_str(&format!("{byte:02x}"));
    }
    Ok(s)
}

// ───────────────────────── Puerta: bloqueo y token ─────────────────────────

#[derive(Default)]
pub struct AppGate {
    cache: Mutex<Option<Zeroizing<String>>>,
}

impl AppGate {
    pub fn forget(&self) {
        *self.cache.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    fn set(&self, token: Zeroizing<String>) {
        *self.cache.lock().unwrap_or_else(|p| p.into_inner()) = Some(token);
    }
}

impl http::Gate for AppGate {
    fn locked(&self) -> bool {
        let locked = Vault::global().status().locked;
        if locked {
            self.forget();
        }
        locked
    }

    fn token(&self) -> Option<Zeroizing<String>> {
        if let Some(t) = self.cache.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            return Some(t);
        }
        match secrets::get_secret(TOKEN_ID) {
            Ok(Some(t)) if !t.is_empty() => {
                let t = Zeroizing::new(t);
                self.set(t.clone());
                Some(t)
            }
            Ok(_) => None,
            Err(e) => {
                log::warn!("MCP: no se pudo leer el token: {e}");
                None
            }
        }
    }
}

// ───────────────────────── Estado de la app ─────────────────────────

struct Running {
    port: u16,
    ct: CancellationToken,
}

pub struct McpState {
    pub core: Arc<core::McpCore<TauriBackend>>,
    pub pending: Arc<PendingApprovals>,
    pub ui: Arc<UiBridge>,
    pub gate: Arc<AppGate>,
    running: Mutex<Option<Running>>,
    last_error: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub error: Option<String>,
    pub approval_timeout_secs: u32,
    pub bridge_path: String,
    pub bridge_found: bool,
    pub app_image: bool,
    pub audit_path: Option<String>,
}

/// Configuración lista para copiar en el cliente.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub claude_code_stdio: String,
    pub claude_code_http: String,
    pub claude_desktop_json: String,
    pub url: String,
    pub token: String,
}

impl McpState {
    pub fn new(app: &AppHandle) -> Self {
        let pending = Arc::new(PendingApprovals::default());
        let ui = Arc::new(UiBridge::default());
        let audit = AuditLog::load();
        let emitter = app.clone();
        audit.set_notify(move |e| {
            let _ = emitter.emit(EV_ACTIVITY, e);
        });
        let backend = TauriBackend { app: app.clone(), pending: pending.clone(), ui: ui.clone() };
        let core = Arc::new(core::McpCore::new(backend, McpConfigStore::load(), audit));
        McpState {
            core,
            pending,
            ui,
            gate: Arc::new(AppGate::default()),
            running: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }

    pub(super) fn config(&self) -> McpConfig {
        self.core.config.get()
    }

    pub fn status(&self) -> McpStatus {
        let cfg = self.config();
        let running = self.running.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|r| r.port);
        let port = running.unwrap_or(cfg.port);
        let bridge = bridge_path();
        McpStatus {
            enabled: cfg.enabled,
            running: running.is_some(),
            port,
            url: format!("http://127.0.0.1:{port}{}", http::MCP_PATH),
            error: self.last_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
            approval_timeout_secs: cfg.approval_timeout_secs,
            bridge_found: bridge.as_ref().is_some_and(|p| p.is_file()),
            bridge_path: bridge.map(|p| p.display().to_string()).unwrap_or_else(bridge_file_name),
            app_image: std::env::var_os("APPIMAGE").is_some(),
            audit_path: self.core.audit.path().map(|p| p.display().to_string()),
        }
    }

    pub(super) fn set_error(&self, e: Option<String>) {
        *self.last_error.lock().unwrap_or_else(|p| p.into_inner()) = e;
    }

    /// Apaga el servidor HTTP (si estaba encendido) y deniega lo pendiente.
    pub fn stop(&self, app: &AppHandle) {
        if let Some(r) = self.running.lock().unwrap_or_else(|p| p.into_inner()).take() {
            r.ct.cancel();
            log::info!("MCP: servidor apagado");
        }
        for id in self.pending.deny_all() {
            let _ = app.emit(backend::EV_APPROVAL_DONE, id);
        }
    }

    /// Enciende el servidor en el puerto de los ajustes (lo reinicia si ya estaba).
    pub fn start(&self, app: &AppHandle) -> AppResult<()> {
        self.stop(app);
        let port = self.config().port;
        let listener = match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => l,
            Err(e) => {
                let msg = format!("No se pudo abrir el puerto {port} en 127.0.0.1: {e}. Prueba con otro puerto.");
                self.set_error(Some(msg.clone()));
                return Err(AppError::Network(msg));
            }
        };
        listener.set_nonblocking(true)?;
        let ct = CancellationToken::new();
        *self.running.lock().unwrap_or_else(|p| p.into_inner()) = Some(Running { port, ct: ct.clone() });
        self.set_error(None);
        let core = self.core.clone();
        let gate: Arc<dyn http::Gate> = self.gate.clone();
        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::from_std(listener) {
                Ok(l) => http::serve(l, core, gate, ct).await,
                Err(e) => log::error!("MCP: no se pudo usar el puerto: {e}"),
            }
        });
        log::info!("MCP: escuchando en http://127.0.0.1:{port}{}", http::MCP_PATH);
        Ok(())
    }

    pub(super) fn emit_status(&self, app: &AppHandle) -> McpStatus {
        let s = self.status();
        let _ = app.emit(EV_STATUS, &s);
        s
    }
}

/// Ruta esperada del puente: junto al programa de SSHorus.
pub fn bridge_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.with_file_name(bridge_file_name()))
}

/// Al arrancar la app: si el MCP estaba encendido, se enciende.
pub fn start_if_enabled(app: &AppHandle) {
    let Some(state) = app.try_state::<McpState>() else { return };
    if state.config().enabled
        && let Err(e) = state.start(app)
    {
        log::warn!("MCP: {e}");
    }
}

/// La bóveda cambió de estado (lo llama `storage::lock`).
pub fn on_vault_change(app: &AppHandle) {
    let Some(state) = app.try_state::<McpState>() else { return };
    state.gate.forget();
    if Vault::global().status().locked {
        for id in state.pending.deny_all() {
            let _ = app.emit(backend::EV_APPROVAL_DONE, id);
        }
    }
}

/// Lee el token o crea uno si no hay (o se perdió con «Olvidé mi PIN»).
pub(crate) async fn ensure_token(state: &McpState) -> AppResult<Zeroizing<String>> {
    let existing = blocking(|| secrets::get_secret(TOKEN_ID)).await?;
    if let Some(t) = existing.filter(|t| !t.is_empty()) {
        return Ok(Zeroizing::new(t));
    }
    regenerate(state).await
}

pub(super) async fn regenerate(state: &McpState) -> AppResult<Zeroizing<String>> {
    let token = new_token()?;
    let t = token.clone();
    blocking(move || secrets::set_secret(TOKEN_ID, &t)).await?;
    state.gate.set(token.clone());
    Ok(token)
}

pub(super) fn emit_auto(app: &AppHandle, state: &McpState) -> Vec<core::AutoState> {
    let list = state.core.auto_list_at(audit::now_ms());
    let _ = app.emit(EV_AUTO, &list);
    list
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}
