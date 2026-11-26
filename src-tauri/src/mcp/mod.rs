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
//! - `bridge`: puente stdio (`sshorus-mcp`) y su `pair`, compartido con `src/bin/sshorus-mcp.rs`;
//!   `install`: copia del puente a una ruta fija.
//! - `pairing`: emparejar asistentes con «Aceptar / Rechazar», un token y permisos por asistente;
//!   `oauth`: lo mismo para los que se conectan por HTTP directo, con la autorización estándar de MCP;
//!   `caller`: quién llama y con qué permisos; `gate`: bloqueo y tokens.

pub mod approval;
pub mod audit;
pub mod backend;
#[allow(dead_code)] // el binario `sshorus-mcp` sí lo usa todo
pub mod bridge;
pub mod caller;
pub mod commands;
pub mod config;
pub mod core;
pub mod diff;
pub mod gate;
pub mod grants;
pub mod http;
pub mod install;
pub mod local_guard;
pub mod oauth;
pub mod pairing;
pub mod policy;
pub mod prompt;
pub mod protect;
pub mod pty_run;
pub mod redact;
pub mod rules;
pub mod server;
pub mod server_audit;
pub use crate::snippets::sudo;
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
use gate::AppGate;
use pairing::Pairing;
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
    bridge::paths::file_name()
}

/// Token general nuevo: «tv_» + 64 caracteres hexadecimales (32 bytes al azar).
pub fn new_token() -> AppResult<Zeroizing<String>> {
    Ok(Zeroizing::new(format!("tv_{}", pairing::token::random_hex(32)?.as_str())))
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
    pub pairing: Arc<Pairing>,
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
    /// Puente que se usa en las configuraciones: el de la ruta fija si ya está copiado; si no, el del paquete.
    pub bridge_path: String,
    pub bridge_found: bool,
    /// `bridge_path` es la ruta fija (no cambia aunque la AppImage cambie de carpeta).
    pub bridge_stable: bool,
    /// Orden para emparejar: «sshorus-mcp pair» si la carpeta está en PATH; si no, con la ruta completa.
    pub pair_command: String,
    /// Orden para conectar Claude Code por HTTP directo, sin token (empareja por OAuth al usarlo).
    pub http_pair_command: String,
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
        let pairing = Arc::new(Pairing::new(
            pairing::registry::ClientRegistry::load(),
            Box::new(pairing::notify::TauriNotifier(app.clone())),
        ));
        let core = Arc::new(core::McpCore::new(backend, McpConfigStore::load(), audit).with_paired(pairing.clone()));
        let oauth = Arc::new(oauth::OAuth::load(pairing.clone()));
        McpState {
            core,
            pending,
            ui,
            gate: Arc::new(AppGate::new(pairing.clone(), oauth)),
            pairing,
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
        let bridge = install::preferred_path();
        let stable = bridge.as_ref().is_some_and(|(_, s)| *s);
        let in_path = stable
            && bridge.as_ref().and_then(|(p, _)| p.parent()).is_some_and(|d| {
                bridge::paths::dir_in_path(d, std::env::var_os("PATH").as_deref())
            });
        let bridge_text = bridge.as_ref().map(|(p, _)| p.display().to_string()).unwrap_or_else(bridge_file_name);
        let pair_command = if in_path {
            "sshorus-mcp pair".to_string()
        } else {
            format!("{} pair", bridge::register::shell_quote(&bridge_text))
        };
        let url = format!("http://127.0.0.1:{port}{}", http::MCP_PATH);
        McpStatus {
            enabled: cfg.enabled,
            running: running.is_some(),
            port,
            http_pair_command: format!("claude mcp add --transport http sshorus {url}"),
            url,
            error: self.last_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
            approval_timeout_secs: cfg.approval_timeout_secs,
            bridge_found: bridge.as_ref().is_some_and(|(p, _)| p.is_file()),
            bridge_path: bridge_text,
            bridge_stable: stable,
            pair_command,
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
        self.pairing.reject_all();
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

/// Al arrancar la app: el puente a su ruta fija y, si el MCP estaba encendido, se enciende.
pub fn on_app_start(app: &AppHandle) {
    install::install_in_background();
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
        state.pairing.reject_all();
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

/// Tras cambiar permisos (generales o de un asistente): apaga «Aceptar automáticamente» donde ya nadie
/// puede usarlo y avisa a la interfaz.
pub(super) fn prune_auto(app: &AppHandle, state: &McpState) -> AppResult<()> {
    if state.core.prune_auto_at(audit::now_ms())? {
        emit_auto(app, state);
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}
