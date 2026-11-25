//! Quién es el cliente OAuth (funciones puras). SSHorus no tiene clientes registrados de antemano: acepta
//! los dos modos de MCP para clientes que no conoce.
//!
//! - Documento de metadatos del cliente (el preferido por MCP desde 2025-11-25): el `client_id` es una
//!   dirección `https://` con su nombre y sus direcciones de vuelta. SSHorus la descarga (`fetch.rs`) y
//!   comprueba que el documento dice ser esa misma dirección. Así se sabe de qué sitio viene (p. ej.
//!   claude.ai para Claude Code).
//! - Registro dinámico (RFC 7591; obsoleto en MCP 2026-07-28 pero aún lo usan muchos clientes): el cliente
//!   se registra solo con `POST /register`. Nada de eso está comprobado: el diálogo lo dice.
//!
//! En los dos casos solo valen direcciones de vuelta a este equipo (`redirect.rs`) y clientes públicos
//! (sin secreto: `token_endpoint_auth_method` = `none`), siempre con PKCE.

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::super::pairing::applicant::clip;
use super::redirect;

/// Direcciones de vuelta que se guardan como mucho por cliente.
const MAX_REDIRECTS: usize = 10;
const AUTH_NONE: &str = "none";

/// De dónde sale lo que sabemos del cliente.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    /// Documento de metadatos descargado de este sitio (por HTTPS).
    Metadata { host: String },
    /// Se registró solo en este equipo (sin comprobar).
    Registered,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub client_id: String,
    pub name: String,
    /// Solo las de vuelta a este equipo.
    pub redirect_uris: Vec<String>,
    pub source: Source,
}

/// `client_id` con la forma de un documento de metadatos: `https://`, con ruta, sin usuario ni fragmento, y
/// con un nombre de sitio (ni IP ni `localhost`).
pub fn metadata_url(client_id: &str) -> Option<Url> {
    let u = Url::parse(client_id).ok()?;
    // `domain()` es None si la máquina es una IP.
    let named = u.domain().is_some_and(|d| !d.eq_ignore_ascii_case("localhost"));
    let ok = u.scheme() == "https"
        && named
        && u.path() != "/"
        && u.username().is_empty()
        && u.password().is_none()
        && u.fragment().is_none();
    ok.then_some(u)
}

/// Solo las de vuelta a este equipo, sin repetir y con un máximo.
fn local_redirects(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in list.iter().filter(|r| redirect::loopback(r).is_some()) {
        if !out.contains(r) && out.len() < MAX_REDIRECTS {
            out.push(r.clone());
        }
    }
    out
}

fn public_client(method: Option<&str>) -> bool {
    method.is_none_or(|m| m == AUTH_NONE)
}

#[derive(Debug, Deserialize)]
struct MetadataDoc {
    client_id: String,
    #[serde(default)]
    client_name: Option<String>,
    #[serde(default)]
    redirect_uris: Vec<String>,
    #[serde(default)]
    token_endpoint_auth_method: Option<String>,
}

/// Valida un documento de metadatos descargado de `client_id`.
pub fn from_metadata(client_id: &str, body: &[u8]) -> Result<ClientInfo, String> {
    let url = metadata_url(client_id).ok_or("El client_id no es una dirección https válida.")?;
    let doc: MetadataDoc = serde_json::from_slice(body).map_err(|_| "El documento del cliente no es JSON válido.")?;
    if doc.client_id != client_id {
        return Err("El documento del cliente dice ser de otra dirección.".into());
    }
    if !public_client(doc.token_endpoint_auth_method.as_deref()) {
        return Err("SSHorus solo acepta clientes públicos (sin secreto) con PKCE.".into());
    }
    let redirect_uris = local_redirects(&doc.redirect_uris);
    if redirect_uris.is_empty() {
        return Err("El cliente no declara ninguna dirección de vuelta a este equipo.".into());
    }
    let host = url.host_str().unwrap_or_default().to_string();
    let name = doc.client_name.map(|n| clip(&n, 60)).filter(|n| !n.is_empty()).unwrap_or_else(|| host.clone());
    Ok(ClientInfo { client_id: client_id.to_string(), name, redirect_uris, source: Source::Metadata { host } })
}

/// Petición de registro dinámico (RFC 7591), solo con lo que SSHorus usa.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct RegistrationRequest {
    pub client_name: Option<String>,
    pub redirect_uris: Vec<String>,
    pub grant_types: Option<Vec<String>>,
    pub response_types: Option<Vec<String>>,
    pub token_endpoint_auth_method: Option<String>,
}

/// Error de registro (RFC 7591 §3.2.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrationError {
    pub code: &'static str,
    pub description: String,
}

fn reg_error(code: &'static str, description: &str) -> RegistrationError {
    RegistrationError { code, description: description.into() }
}

impl RegistrationError {
    /// Falló SSHorus, no la petición.
    pub fn server(e: impl std::fmt::Display) -> Self {
        RegistrationError { code: "server_error", description: e.to_string() }
    }
}

const GRANTS: [&str; 2] = ["authorization_code", "refresh_token"];

/// Valida un registro dinámico y le da `client_id`.
pub fn register(req: RegistrationRequest, client_id: String) -> Result<ClientInfo, RegistrationError> {
    if req.redirect_uris.is_empty() || req.redirect_uris.iter().any(|r| redirect::loopback(r).is_none()) {
        return Err(reg_error(
            "invalid_redirect_uri",
            "Solo se aceptan direcciones de vuelta a este equipo: http://127.0.0.1, http://[::1] o http://localhost.",
        ));
    }
    if !public_client(req.token_endpoint_auth_method.as_deref()) {
        return Err(reg_error("invalid_client_metadata", "Solo clientes públicos: token_endpoint_auth_method = none."));
    }
    if req.grant_types.as_ref().is_some_and(|g| g.iter().any(|x| !GRANTS.contains(&x.as_str()))) {
        return Err(reg_error("invalid_client_metadata", "Solo authorization_code y refresh_token."));
    }
    if req.response_types.as_ref().is_some_and(|r| r.iter().any(|x| x != "code")) {
        return Err(reg_error("invalid_client_metadata", "Solo response_type = code."));
    }
    let name = req.client_name.map(|n| clip(&n, 60)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Asistente".into());
    Ok(ClientInfo { client_id, name, redirect_uris: local_redirects(&req.redirect_uris), source: Source::Registered })
}

/// Respuesta del registro (RFC 7591 §3.2.1).
pub fn registration_response(c: &ClientInfo, issued_at_secs: u64) -> Value {
    json!({
        "client_id": c.client_id,
        "client_id_issued_at": issued_at_secs,
        "client_name": c.name,
        "redirect_uris": c.redirect_uris,
        "grant_types": GRANTS,
        "response_types": ["code"],
        "token_endpoint_auth_method": AUTH_NONE,
    })
}
