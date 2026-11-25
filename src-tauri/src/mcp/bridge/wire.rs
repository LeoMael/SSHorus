//! Lo que se dicen el puente (`sshorus-mcp pair`) y la app al emparejar un asistente (`POST /pair`).
//!
//! Una sola definición para los dos lados: la app la usa como `mcp::bridge::wire` y el binario del puente
//! la compila con el resto de `bridge/`. Solo crates externos.

use serde::{Deserialize, Serialize};

/// Ruta HTTP de las peticiones de emparejado.
pub const PAIR_PATH: &str = "/pair";
/// Lo que espera la app tu respuesta antes de rechazar sola (segundos).
pub const PAIR_WAIT_SECS: u64 = 120;
/// Variable con el id del asistente: la pone `pair` al registrarse en la configuración del cliente, así
/// el puente no tiene que adivinarlo cada vez. No es un secreto.
pub const CLIENT_ENV: &str = "SSHORUS_MCP_CLIENT";
/// Servicio del llavero (el mismo que usa la app).
pub const KEYRING_SERVICE: &str = "sshorus";
/// Largo máximo del id de un asistente.
const MAX_ID: usize = 40;

/// Usuario del llavero con el token de un asistente emparejado.
pub fn keyring_user(client_id: &str) -> String {
    format!("mcp-client:{client_id}")
}

/// Id válido: minúsculas, números, `-`, `_` y `.`; lo demás pasa a `-`. None si queda vacío.
pub fn clean_client_id(raw: &str) -> Option<String> {
    let id: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '-' })
        .take(MAX_ID)
        .collect();
    let id = id.trim_matches('-').to_string();
    (!id.is_empty()).then_some(id)
}

/// Lo que el puente vio del programa que lo lanzó (datos del sistema local, no comprobados).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    /// Id del asistente («claude», «codex»…): el token se guarda con este nombre.
    pub client_id: String,
    /// Nombre para mostrar («Claude Code»).
    pub name: String,
    /// Programa que se detectó (línea de comandos recortada).
    pub program: String,
    pub pid: Option<u32>,
    /// Carpeta en la que trabaja.
    pub cwd: Option<String>,
    /// Versión del puente.
    pub version: String,
}

/// Cómo terminó una petición de emparejado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairOutcome {
    Accepted,
    Rejected,
    /// Nadie respondió a tiempo.
    Timeout,
    /// Demasiadas peticiones (o ya hay una de este asistente esperando).
    Busy,
    /// SSHorus está bloqueado con el PIN.
    Locked,
    /// Petición mal formada.
    Invalid,
}

/// Acceso concedido en un servidor (para que la IA sepa con qué cuenta).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGrant {
    pub name: String,
    /// «Solo lectura», «Completo»…
    pub access: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairReply {
    pub outcome: PairOutcome,
    /// Frase para la persona o la IA.
    pub message: String,
    /// Solo si se aceptó. El puente lo guarda en el llavero y no lo muestra.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<ServerGrant>,
}

impl PairReply {
    pub fn new(outcome: PairOutcome, message: impl Into<String>) -> Self {
        PairReply { outcome, message: message.into(), token: None, servers: Vec::new() }
    }

    /// Código HTTP de cada resultado (el cuerpo siempre es este JSON).
    pub fn http_status(&self) -> u16 {
        match self.outcome {
            PairOutcome::Accepted => 200,
            PairOutcome::Rejected => 403,
            PairOutcome::Timeout => 408,
            PairOutcome::Busy => 429,
            PairOutcome::Locked => 423,
            PairOutcome::Invalid => 400,
        }
    }
}
