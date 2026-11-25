//! Con qué arranca el puente: puerto de la app, token y de qué asistente es.
//!
//! Token, por orden:
//! 1. `SSHORUS_MCP_TOKEN` (la configuración copiada a mano; sigue valiendo, también el token general).
//! 2. El del llavero de este asistente, guardado por `sshorus-mcp pair`. El asistente sale de
//!    `SSHORUS_MCP_CLIENT` (lo pone `pair` al registrarse) o, si falta, de la cadena de procesos.
//! 3. Ninguno: el puente arranca igual y le dice a la IA que ejecute `sshorus-mcp pair` (no se queda
//!    esperando: el cliente MCP cortaría el arranque).

use std::time::Duration;

use serde_json::Value;

use super::{caller, clients, keyring_store, wire};

pub const DEFAULT_PORT: u16 = 47821;

/// Dónde buscar el token de un asistente en el llavero (también al volver a mirar tras emparejar).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairLookup {
    pub client_id: String,
    pub service: String,
}

impl PairLookup {
    pub fn load(&self) -> Option<String> {
        let user = wire::keyring_user(&self.client_id);
        match keyring_store::get(&self.service, &user) {
            Ok(t) => t.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
            Err(e) => {
                eprintln!("sshorus-mcp: no se pudo leer el llavero: {e}");
                None
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub port: u16,
    pub token: Option<String>,
    pub version: String,
    /// Cada cuánto se mira si la app ya está abierta (tras responder «cerrada»).
    pub poll: Duration,
    /// Sin token de entorno: el asistente cuyo token se busca en el llavero.
    pub pairing: Option<PairLookup>,
}

impl BridgeConfig {
    /// Lee el entorno, `mcp.json` y el llavero.
    pub fn from_env(version: &str) -> Self {
        let env_token = env_var("SSHORUS_MCP_TOKEN");
        let pairing = env_token.is_none().then(|| {
            // La cadena de procesos solo si hace falta: en Windows cuesta lanzar PowerShell en cada arranque.
            let id = env_var(wire::CLIENT_ENV)
                .and_then(|c| wire::clean_client_id(&c))
                .or_else(|| clients::detect(&caller::parent_chain()).map(|d| d.id))
                .unwrap_or_else(|| "asistente".into());
            PairLookup { client_id: id, service: wire::KEYRING_SERVICE.into() }
        });
        let token = resolve_token(env_token, pairing.as_ref(), PairLookup::load);
        BridgeConfig { port: discover_port(), token, version: version.to_string(), poll: Duration::from_secs(2), pairing }
    }
}

/// El de entorno gana; si no hay, el del llavero de ese asistente.
pub fn resolve_token(
    env_token: Option<String>,
    pairing: Option<&PairLookup>,
    load: impl Fn(&PairLookup) -> Option<String>,
) -> Option<String> {
    env_token.or_else(|| pairing.and_then(load))
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

/// `SSHORUS_MCP_PORT`, o el de `<config>/sshorus/mcp.json`, o 47821.
pub fn discover_port() -> u16 {
    env_var("SSHORUS_MCP_PORT")
        .and_then(|p| p.parse::<u16>().ok())
        .or_else(port_from_config)
        .unwrap_or(DEFAULT_PORT)
}

fn port_from_config() -> Option<u16> {
    let path = dirs::config_dir()?.join("sshorus").join("mcp.json");
    let v: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    v.get("port")?.as_u64().and_then(|p| u16::try_from(p).ok())
}
