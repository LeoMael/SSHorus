//! Descubrimiento (funciones puras): las direcciones de este servidor y sus documentos de metadatos.
//!
//! - Recurso protegido (RFC 9728): `/.well-known/oauth-protected-resource/mcp` (y en la raíz). Dice que el
//!   servidor de autorización es el propio SSHorus.
//! - Servidor de autorización (RFC 8414): `/.well-known/oauth-authorization-server`.
//! - `WWW-Authenticate` del 401 con `resource_metadata` (así el cliente sabe por dónde empezar).
//!
//! Todo se arma con la cabecera `Host` de la petición, que antes se comprueba (`Here::from_host`): solo
//! `127.0.0.1`, `localhost` o `[::1]` con el puerto en el que escucha SSHorus. Así una página web que se
//! haga pasar por otro nombre (DNS rebinding) no llega a nada.

use reqwest::Url;
use serde_json::{json, Value};

use super::super::http::MCP_PATH;

pub const PRM_PATH: &str = "/.well-known/oauth-protected-resource";
pub const AS_PATH: &str = "/.well-known/oauth-authorization-server";
pub const AUTHORIZE_PATH: &str = "/authorize";
/// La página de espera vuelve aquí (y aquí se espera tu respuesta).
pub const WAIT_PATH: &str = "/authorize/wait";
pub const TOKEN_PATH: &str = "/token";
pub const REGISTER_PATH: &str = "/register";
pub const REVOKE_PATH: &str = "/revoke";

const LOOPBACK_NAMES: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/// Este servidor tal como lo nombra el cliente (`http://127.0.0.1:<puerto>`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Here {
    origin: String,
}

impl Here {
    /// Desde la cabecera `Host`: solo un nombre local con el puerto en el que escucha SSHorus.
    pub fn from_host(host: &str, port: u16) -> Option<Here> {
        let host = host.trim().to_ascii_lowercase();
        let (name, p) = host.rsplit_once(':')?;
        let ok = LOOPBACK_NAMES.contains(&name) && p.parse::<u16>().ok() == Some(port);
        ok.then(|| Here { origin: format!("http://{name}:{port}") })
    }

    /// Identificador del servidor de autorización (`iss`).
    pub fn issuer(&self) -> &str {
        &self.origin
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.origin)
    }

    /// El recurso al que van ligados los tokens: la dirección de `/mcp`.
    pub fn resource(&self) -> String {
        self.url(MCP_PATH)
    }

    pub fn resource_metadata_url(&self) -> String {
        self.url(&format!("{PRM_PATH}{MCP_PATH}"))
    }
}

/// RFC 9728.
pub fn protected_resource(h: &Here) -> Value {
    json!({
        "resource": h.resource(),
        "authorization_servers": [h.issuer()],
        "bearer_methods_supported": ["header"],
        "resource_name": "SSHorus",
    })
}

/// RFC 8414. Clientes sin registro previo: documento de metadatos del cliente (preferido por MCP) o registro
/// dinámico (RFC 7591, para los que aún no lo tienen). Clientes públicos con PKCE S256, sin secreto.
pub fn authorization_server(h: &Here) -> Value {
    json!({
        "issuer": h.issuer(),
        "authorization_endpoint": h.url(AUTHORIZE_PATH),
        "token_endpoint": h.url(TOKEN_PATH),
        "registration_endpoint": h.url(REGISTER_PATH),
        "revocation_endpoint": h.url(REVOKE_PATH),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "client_id_metadata_document_supported": true,
        "authorization_response_iss_parameter_supported": true,
    })
}

/// Valor de `WWW-Authenticate` para un 401 (con `error="invalid_token"` si se mandó uno que no vale).
pub fn challenge(h: &Here, invalid_token: bool) -> String {
    let error = if invalid_token { ", error=\"invalid_token\"" } else { "" };
    format!("Bearer resource_metadata=\"{}\"{error}", h.resource_metadata_url())
}

fn canonical(uri: &str) -> Option<(String, String, Option<u16>, String)> {
    let u = Url::parse(uri.trim()).ok()?;
    if u.fragment().is_some() || u.query().is_some() {
        return None;
    }
    let host = u.host_str()?.to_ascii_lowercase();
    let host = if LOOPBACK_NAMES.contains(&host.as_str()) { "loopback".to_string() } else { host };
    Some((u.scheme().to_string(), host, u.port_or_known_default(), u.path().trim_end_matches('/').to_string()))
}

/// Es el mismo recurso (RFC 8707). `127.0.0.1`, `localhost` y `[::1]` cuentan como el mismo equipo; el
/// puerto y la ruta tienen que coincidir.
pub fn same_resource(a: &str, b: &str) -> bool {
    matches!((canonical(a), canonical(b)), (Some(x), Some(y)) if x == y)
}
