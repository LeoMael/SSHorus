//! Lógica de las herramientas del asistente: permisos, aprobación, ejecución, límites y registro.
//!
//! Orden de cada llamada:
//! 1. ¿MCP encendido? ¿SSHorus desbloqueado? Si no, se rechaza todo con un mensaje claro.
//! 2. Se busca el servidor y su nivel de acceso (Sin acceso = rechazado).
//! 3. `policy::decide_rules`: lectura → pasa; cambio → diálogo en SSHorus (o regla «siempre», o el modo
//!    «Aceptar automáticamente» del servidor); peligroso → diálogo (salvo modo automático «todo»);
//!    solo lectura → los cambios se rechazan. El modo automático nunca vale con SSHorus bloqueado.
//!    «Solo lo marcado» → fuera de las casillas se rechaza (`grants`, `core/marked.rs`); los usuarios
//!    protegidos (`protect`) se rechazan o preguntan siempre en cualquier nivel.
//! 4. Se ejecuta con los límites de tiempo y de salida, y se anota en el registro.
//!
//! Las contraseñas y llaves nunca llegan al asistente: usa conexiones ya abiertas en la app. La única que
//! pasa por aquí es la de sudo: tras aprobar un comando con sudo, la consigue la interfaz y va por stdin al
//! envoltorio de `sudo.rs` (`core/elevation.rs`); no aparece en la respuesta, en el registro ni en la línea
//! de comandos remota. Solo `request_sudo_password` (`core/sudo_reveal.rs`) se la da a la IA: apagado por
//! defecto y, si el usuario lo enciende, siempre con un diálogo propio. Los programas que piden una
//! contraseña por su cuenta van con `run_with_password` (`core/password_run.rs`): SSHorus la escribe en su
//! terminal y la IA solo ve la salida, con la contraseña tapada. Las salidas de comandos y archivos también
//! se tapan si muestran una contraseña guardada del servidor (`core/redaction.rs`).
//!
//! Partes (`core/`): `params` (parámetros de las herramientas), `auto` (Aceptar automáticamente),
//! `access` (servidor, permisos y aprobación), `listing` (herramientas sin servidor), `catalog`
//! (Biblioteca), `commands`, `files`, `scans` (escaneos, vulnerabilidades y auditoría) y `output`
//! (formato de las respuestas).

mod access;
mod ask;
mod auto;
mod catalog;
mod commands;
mod elevation;
mod files;
mod listing;
mod marked;
mod output;
mod params;
mod password_run;
mod reboot;
mod redaction;
mod scans;
mod sudo_reveal;

pub use auto::{AutoDuration, AutoState};
pub use catalog::CatalogEntry;
#[cfg(test)]
pub use elevation::SUDO_CANCELED_MSG;
#[cfg(test)]
pub use output::clip_middle;
pub use params::{
    AuditReportParams, CatalogListParams, CatalogRunParams, ConnectParams, DownloadParams, ListDirParams, NoParams,
    PathParams, ReadFileParams, RunCommandParams, ServerParams, TransferStatusParams, UploadParams, VulnReportParams,
    VulnScanParams, WriteFileParams,
};
pub use password_run::PasswordRunParams;
pub use reboot::RebootServerParams;
pub use sudo_reveal::SudoPasswordParams;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::audit::{AuditEntry, AuditLog, AuditStatus};
use super::caller::Caller;
use super::backend::Backend;
use super::config::McpConfigStore;
use super::policy::{Access, AutoGrant};
use crate::error::AppError;
use crate::types::{ServerProfile, SessionInfo};
use output::{first_line, parse};

pub const LOCKED_MSG: &str = "SSHorus está bloqueado: desbloquéalo para continuar.";
pub const DISABLED_MSG: &str =
    "El servidor MCP de SSHorus está apagado. Actívalo en SSHorus → Ajustes → Asistentes de IA (MCP).";

/// Salida por defecto de cada flujo de `run_command` (KB) y máximo permitido.
pub const DEFAULT_OUTPUT_KB: u32 = 64;
pub const MAX_OUTPUT_KB: u32 = 512;
/// Tiempo por defecto de un comando (s). El máximo lo pone el exec (600 s).
pub const DEFAULT_TIMEOUT_SECS: u32 = 60;
/// Lectura de archivos: por defecto y máximo.
pub const DEFAULT_READ_BYTES: u64 = 64 * 1024;
pub const MAX_READ_BYTES: u64 = 1024 * 1024;
/// Tamaño máximo de `write_file`.
pub const MAX_WRITE_BYTES: usize = 1024 * 1024;
/// Entradas máximas de `list_dir`.
pub const MAX_DIR_ENTRIES: usize = 2000;
/// Texto máximo devuelto por las herramientas de escaneo (puertos, sitios, contenedores).
pub const MAX_SCAN_BYTES: usize = 200 * 1024;
/// Tiempo de espera de la interfaz al abrir una pestaña (puede pedir contraseña o huella).
const UI_CONNECT_TIMEOUT: Duration = Duration::from_secs(180);
const UI_SCAN_TIMEOUT: Duration = Duration::from_secs(90);
/// Tiempo límite de `run_audit` (la interfaz lee SSH, usuarios, puertos, sitios, contenedores…).
const UI_AUDIT_TIMEOUT: Duration = Duration::from_secs(240);
/// Tiempo límite de `scan_vulnerabilities` (s): por defecto, mínimo y máximo.
pub const DEFAULT_VULN_SCAN_SECS: u32 = 600;
pub const MIN_VULN_SCAN_SECS: u32 = 60;
pub const MAX_VULN_SCAN_SECS: u32 = 1800;
/// Margen para que el análisis termine de detenerse en el servidor tras el tiempo límite.
const VULN_STOP_GRACE: Duration = Duration::from_secs(30);

// ───────────────────────── Resultado ─────────────────────────

/// Lo que devuelve una herramienta: texto para el asistente y si es un error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutput {
    pub text: String,
    pub is_error: bool,
}

/// Por qué falló una herramienta.
#[derive(Debug)]
enum Fail {
    /// No permitido (sin acceso, solo lectura, denegado o sin respuesta).
    Denied(String),
    Locked,
    /// Error al hacerlo.
    Error(String),
}

impl From<AppError> for Fail {
    fn from(e: AppError) -> Self {
        match e {
            AppError::Locked => Fail::Locked,
            other => Fail::Error(other.to_string()),
        }
    }
}

type Res<T> = Result<T, Fail>;

/// Entrada del registro que se va completando durante la llamada.
struct Rec {
    entry: AuditEntry,
    started: Instant,
    /// Quién llama: decide el nivel de acceso a cada servidor.
    caller: Caller,
}

/// Servidor sobre el que se actúa.
struct Target {
    server: ServerProfile,
    access: Access,
    session: Option<SessionInfo>,
}

impl Target {
    fn session_id(&self) -> Res<&str> {
        self.session.as_ref().map(|s| s.id.as_str()).ok_or_else(|| {
            Fail::Error(format!(
                "No hay una conexión abierta con «{}». Usa la herramienta connect primero.",
                self.server.name
            ))
        })
    }
}

pub struct McpCore<B: Backend> {
    pub backend: B,
    pub config: McpConfigStore,
    pub audit: AuditLog,
    /// Catálogo base (lo manda la interfaz la primera vez que hace falta).
    catalog: Mutex<Option<Vec<CatalogEntry>>>,
    /// Servidores con un `scan_vulnerabilities` en curso (uno a la vez por servidor).
    vuln_scans: Mutex<BTreeSet<String>>,
    /// «Aceptar automáticamente» temporal (15 min, 1 h, hasta cerrar SSHorus): solo en memoria.
    auto_temp: Mutex<BTreeMap<String, AutoGrant>>,
}

impl<B: Backend> McpCore<B> {
    pub fn new(backend: B, config: McpConfigStore, audit: AuditLog) -> Self {
        McpCore {
            backend,
            config,
            audit,
            catalog: Mutex::new(None),
            vuln_scans: Mutex::new(BTreeSet::new()),
            auto_temp: Mutex::new(BTreeMap::new()),
        }
    }

    /// Ejecuta una herramienta con el token general. `cancel` se dispara si el cliente cancela la petición.
    #[cfg(test)]
    pub async fn call(&self, tool: &str, args: Value, client: Option<String>, cancel: CancellationToken) -> ToolOutput {
        self.call_as(tool, args, client, Caller::default(), cancel).await
    }

    /// Ejecuta una herramienta para `caller` (sus permisos por servidor; ver `caller.rs`). `label` es el
    /// User-Agent del puente o cliente.
    pub async fn call_as(&self, tool: &str, args: Value, label: Option<String>, caller: Caller, cancel: CancellationToken) -> ToolOutput {
        let mut entry = AuditEntry::start(tool);
        match &caller.client {
            Some(c) => {
                entry.client = Some(c.name.clone());
                entry.client_id = Some(c.id.clone());
            }
            None => entry.client = label,
        }
        let mut rec = Rec { entry, started: Instant::now(), caller };
        let out = match self.gate() {
            Err(f) => Err(f),
            Ok(()) => self.dispatch(tool, args, &mut rec, &cancel).await,
        };
        let (status, text, is_error) = match out {
            Ok(text) => (AuditStatus::Ok, text, false),
            Err(Fail::Denied(m)) => (AuditStatus::Denied, m, true),
            Err(Fail::Locked) => (AuditStatus::Locked, LOCKED_MSG.to_string(), true),
            Err(Fail::Error(m)) => (AuditStatus::Error, m, true),
        };
        rec.entry.status = status;
        rec.entry.exec_id = None;
        rec.entry.duration_ms = Some(rec.started.elapsed().as_millis() as u64);
        // Errores y rechazos: el motivo. Si salió bien, el resumen que dejó la herramienta (si dejó uno).
        if is_error {
            rec.entry.message = Some(super::audit::clip(first_line(&text), 300));
        }
        self.audit.record(rec.entry);
        ToolOutput { text, is_error }
    }

    fn gate(&self) -> Res<()> {
        if !self.config.get().enabled {
            return Err(Fail::Denied(DISABLED_MSG.into()));
        }
        if self.backend.vault_locked() {
            return Err(Fail::Locked);
        }
        Ok(())
    }

    async fn dispatch(&self, tool: &str, args: Value, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        match tool {
            "list_servers" => self.list_servers(&rec.caller).await,
            "list_projects" => self.list_projects(&rec.caller),
            "list_sessions" => self.list_sessions(&rec.caller).await,
            "list_catalog" => self.list_catalog(parse(args)?).await,
            "connect" => self.connect(parse(args)?, rec).await,
            "run_command" => self.run_command(parse(args)?, rec, cancel).await,
            "run_catalog_command" => self.run_catalog(parse(args)?, rec, cancel).await,
            "list_dir" => self.list_dir(parse(args)?, rec).await,
            "stat" => self.stat(parse(args)?, rec).await,
            "read_file" => self.read_file(parse(args)?, rec).await,
            "write_file" => self.write_file(parse(args)?, rec).await,
            "upload" => self.upload(parse(args)?, rec).await,
            "download" => self.download(parse(args)?, rec).await,
            "transfer_status" => self.transfer_status(parse(args)?, &rec.caller).await,
            "list_ports" => self.scan("ports", parse(args)?, rec).await,
            "list_sites" => self.scan("sites", parse(args)?, rec).await,
            "list_containers" => self.scan("containers", parse(args)?, rec).await,
            "get_infra_map" => self.scan("infra", parse(args)?, rec).await,
            "get_vuln_report" => self.vuln_report(parse(args)?, rec).await,
            "scan_vulnerabilities" => self.vuln_scan(parse(args)?, rec, cancel).await,
            "get_audit_report" => self.audit_report(parse(args)?, rec).await,
            "run_audit" => self.run_audit(parse(args)?, rec).await,
            "request_sudo_password" => self.request_sudo_password(parse(args)?, rec).await,
            "run_with_password" => self.run_with_password(parse(args)?, rec, cancel).await,
            "reboot_server" => self.reboot_server(parse(args)?, rec, cancel).await,
            other => Err(Fail::Error(format!("Herramienta desconocida: {other}"))),
        }
    }
}
