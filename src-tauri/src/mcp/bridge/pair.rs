//! `sshorus-mcp pair`: emparejar un asistente de IA con SSHorus sin copiar secretos.
//!
//! 1. Se mira quién lo lanzó (`caller`, `clients`): normalmente la IA lo ejecuta en su terminal.
//! 2. Se pide a la app (`POST /pair`) y se espera tu respuesta en SSHorus (hasta 2 min).
//! 3. Si aceptas, el token de ESTE asistente se guarda en el llavero del sistema (nunca se muestra) y el
//!    puente se registra en la configuración del asistente sin token (`register`).
//!
//! Salida para personas o, con `--json`, para la IA. Código de salida: 0 bien, 1 error, 2 rechazado.

use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use serde::Serialize;

use super::clients::{self, Detected};
use super::register::{self, Registered, Scope};
use super::wire::{self, PairOutcome, PairReply, PairRequest, ServerGrant};
use super::{caller, config, forward, keyring_store, paths};

/// Margen sobre la espera de la app (que corta a los 2 min) antes de rendirse.
const EXTRA_WAIT: Duration = Duration::from_secs(15);

pub const HELP: &str = "Uso: sshorus-mcp pair [--client claude|codex|gemini|agy|opencode|auto] [--scope user|project] [--json]

Pide a SSHorus (abierto y desbloqueado) que empareje este asistente de IA. Aparece un aviso en SSHorus:
eliges los permisos y pulsas Aceptar. El token se guarda en el llavero del sistema y el puente se
registra en la configuración del asistente, sin secretos.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairArgs {
    pub client: Option<String>,
    pub scope: Scope,
    pub json: bool,
}

pub fn parse_args(args: &[String]) -> Result<PairArgs, String> {
    let mut out = PairArgs { client: None, scope: Scope::User, json: false };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => out.json = true,
            "--client" => out.client = Some(it.next().ok_or("falta el valor de --client")?.clone()),
            "--scope" => {
                let v = it.next().ok_or("falta el valor de --scope")?;
                out.scope = Scope::parse(v).ok_or_else(|| format!("--scope no válido: {v} (usa user o project)"))?;
            }
            other => return Err(format!("opción desconocida: {other}")),
        }
    }
    Ok(out)
}

/// Lo que se cuenta al terminar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub ok: bool,
    pub outcome: Option<PairOutcome>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<ServerGrant>,
    /// Comando con el que se registró el puente.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered: Option<String>,
    /// Qué falta hacer (a mano, o reconectar).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_step: Option<String>,
}

impl Report {
    fn error(message: impl Into<String>) -> Self {
        Report {
            ok: false,
            outcome: None,
            client_id: None,
            client_name: None,
            message: message.into(),
            servers: Vec::new(),
            registered: None,
            next_step: None,
        }
    }

    pub fn exit_code(&self) -> i32 {
        match (self.ok, self.outcome) {
            (true, _) => 0,
            (false, Some(PairOutcome::Rejected | PairOutcome::Timeout)) => 2,
            _ => 1,
        }
    }

    pub fn print(&self, json: bool) {
        if json {
            println!("{}", serde_json::to_string_pretty(self).unwrap_or_default());
            return;
        }
        println!("{}", self.message);
        if !self.servers.is_empty() {
            println!("Permisos:");
            for s in &self.servers {
                println!("  - {}: {}", s.name, s.access);
            }
        }
        if let Some(c) = &self.registered {
            println!("Registrado en el asistente con: {c}");
        }
        if let Some(n) = &self.next_step {
            println!("{n}");
        }
    }
}

/// Por qué no se pudo preguntar a la app.
#[derive(Debug, PartialEq, Eq)]
pub enum AskError {
    /// No hay nadie en el puerto.
    Closed,
    Other(String),
}

pub const CLOSED_HELP: &str = "No se pudo hablar con SSHorus: ábrelo y activa Ajustes → Asistentes de IA (MCP). \
Si tu asistente ejecuta los comandos en un entorno aislado (sandbox) sin red, pide permiso para ejecutar \
este comando fuera de él.";

/// Pide el emparejado a la app y espera la respuesta.
pub async fn ask_app(port: u16, req: &PairRequest) -> Result<PairReply, AskError> {
    let body = serde_json::to_vec(req).map_err(|e| AskError::Other(e.to_string()))?;
    let http_req = http::Request::builder()
        .method(http::Method::POST)
        .uri(wire::PAIR_PATH)
        .header(http::header::HOST, format!("127.0.0.1:{port}"))
        .header(http::header::CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(body)))
        .map_err(|e| AskError::Other(e.to_string()))?;
    let wait = Duration::from_secs(wire::PAIR_WAIT_SECS) + EXTRA_WAIT;
    let resp = tokio::time::timeout(wait, forward::send(port, http_req))
        .await
        .map_err(|_| AskError::Other("SSHorus no respondió a tiempo".into()))?
        .ok_or(AskError::Closed)?;
    let status = resp.status();
    let bytes = tokio::time::timeout(wait, resp.into_body().collect())
        .await
        .map_err(|_| AskError::Other("SSHorus no respondió a tiempo".into()))?
        .map(|b| b.to_bytes())
        .map_err(|e| AskError::Other(e.to_string()))?;
    serde_json::from_slice::<PairReply>(&bytes)
        .map_err(|_| AskError::Other(format!("respuesta inesperada de SSHorus ({status}); ¿la app es de una versión anterior?")))
}

/// La petición con lo que se vio del asistente.
pub fn build_request(d: &Detected, version: &str) -> PairRequest {
    let own_cwd = std::env::current_dir().ok().map(|p| p.display().to_string());
    PairRequest {
        client_id: d.id.clone(),
        name: d.name.clone(),
        program: d.process.as_ref().map(caller::ProcInfo::command_line).unwrap_or_default(),
        pid: d.process.as_ref().map(|p| p.pid),
        cwd: d.process.as_ref().and_then(|p| p.cwd.clone()).or(own_cwd),
        version: version.to_string(),
    }
}

/// Todo el emparejado. `service` es el del llavero («sshorus»).
pub async fn run(args: &PairArgs, version: &str, service: &str) -> Report {
    let env_client = std::env::var(wire::CLIENT_ENV).ok();
    let Some(detected) = clients::resolve(args.client.as_deref(), env_client.as_deref(), &caller::parent_chain()) else {
        return Report::error("No se reconoció el asistente: indica cuál con --client (claude, codex, gemini, agy, opencode).");
    };
    let failed = |message: String| Report {
        client_id: Some(detected.id.clone()),
        client_name: Some(detected.name.clone()),
        ..Report::error(message)
    };
    let user = wire::keyring_user(&detected.id);
    // Antes de molestar al usuario: el token tendrá que caber en el llavero.
    if let Err(e) = keyring_store::get(service, &user) {
        return failed(format!(
            "No se puede usar el llavero del sistema ({e}). Sin llavero, conecta el asistente a mano: SSHorus → Ajustes → \
             Asistentes de IA (MCP)."
        ));
    }
    let reply = match ask_app(config::discover_port(), &build_request(&detected, version)).await {
        Ok(r) => r,
        Err(AskError::Closed) => return failed(CLOSED_HELP.into()),
        Err(AskError::Other(m)) => return failed(m),
    };
    let mut report = Report {
        ok: false,
        outcome: Some(reply.outcome),
        client_id: Some(detected.id.clone()),
        client_name: Some(detected.name.clone()),
        message: reply.message,
        servers: reply.servers,
        registered: None,
        next_step: None,
    };
    let Some(token) = reply.token.filter(|_| reply.outcome == PairOutcome::Accepted) else { return report };
    if let Err(e) = keyring_store::set(service, &user, &token) {
        report.message = format!("SSHorus aceptó, pero no se pudo guardar el token en el llavero: {e}");
        return report;
    }
    report.ok = true;
    let reload = detected.known.map(|k| k.reload).unwrap_or("Reinicia el asistente para que cargue SSHorus.");
    match paths::for_config() {
        Some(bridge) => match register::register(detected.known, &detected.id, args.scope, &bridge) {
            Registered::Done { command } => {
                report.registered = Some(command);
                report.next_step = Some(reload.to_string());
            }
            Registered::Manual { why, instructions } => {
                let why = why.map(|w| format!(" ({w})")).unwrap_or_default();
                report.next_step = Some(format!("Falta registrar el puente en el asistente{why}. {instructions}\n{reload}"));
            }
        },
        None => report.next_step = Some("No se encontró la ruta de sshorus-mcp para registrarlo.".into()),
    }
    report
}
