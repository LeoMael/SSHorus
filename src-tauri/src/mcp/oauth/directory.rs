//! De `client_id` a cliente: descarga su documento de metadatos (con caché) o busca su registro dinámico,
//! que se guarda en `<config>/sshorus/mcp-oauth-registrations.json` (sin secretos: los clientes son
//! públicos) para que siga valiendo tras reiniciar SSHorus.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use futures::future::BoxFuture;
use reqwest::Url;

use super::super::pairing::token;
use super::clients::{self, ClientInfo, RegistrationError, RegistrationRequest};
use super::lock;
use crate::storage::fsutil;

pub const FILE_NAME: &str = "mcp-oauth-registrations.json";
/// Registros dinámicos que se guardan (los más viejos se olvidan).
const KEEP_REGISTRATIONS: usize = 32;
/// Cuánto vale un documento descargado y cuántos se recuerdan.
const CACHE_MS: u64 = 10 * 60 * 1000;
const CACHE_MAX: usize = 16;
/// Tamaño máximo de un documento de metadatos y tiempo para descargarlo.
const MAX_DOC: usize = 16 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// Descarga el documento de metadatos de un cliente.
pub trait DocFetcher: Send + Sync + 'static {
    fn fetch<'a>(&'a self, url: &'a Url) -> BoxFuture<'a, Result<Vec<u8>, String>>;
}

/// Por HTTPS, sin seguir redirecciones, con tiempo y tamaño máximos.
pub struct HttpsFetcher;

async fn fetch_https(url: &Url) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(FETCH_TIMEOUT)
        .user_agent(concat!("SSHorus/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("no se pudo preparar la descarga: {e}"))?;
    let mut resp = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("no se pudo descargar el documento del cliente: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("el documento del cliente respondió {}", resp.status().as_u16()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("descarga interrumpida: {e}"))? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_DOC {
            return Err("el documento del cliente es demasiado grande".into());
        }
    }
    Ok(body)
}

impl DocFetcher for HttpsFetcher {
    fn fetch<'a>(&'a self, url: &'a Url) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        Box::pin(fetch_https(url))
    }
}

/// Pruebas: documentos fijos, sin red.
#[cfg(test)]
pub struct StaticDocs(pub HashMap<String, Vec<u8>>);

#[cfg(test)]
impl DocFetcher for StaticDocs {
    fn fetch<'a>(&'a self, url: &'a Url) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        let found = self.0.get(url.as_str()).cloned().ok_or_else(|| "el documento no existe".to_string());
        Box::pin(async move { found })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct RegistrationsFile {
    clients: Vec<ClientInfo>,
}

pub struct Directory {
    fetcher: Box<dyn DocFetcher>,
    /// client_id → (cliente, cuándo se descargó).
    cache: Mutex<HashMap<String, (ClientInfo, u64)>>,
    path: Option<PathBuf>,
    registered: Mutex<RegistrationsFile>,
}

impl Directory {
    /// `path` None = registros solo en memoria (pruebas).
    pub fn new(fetcher: Box<dyn DocFetcher>, path: Option<PathBuf>) -> Self {
        let registered = path.as_deref().map(fsutil::read_json_or_default).unwrap_or_default();
        Directory { fetcher, cache: Mutex::new(HashMap::new()), path, registered: Mutex::new(registered) }
    }

    pub fn default_path() -> Option<PathBuf> {
        fsutil::config_dir().map(|d| d.join(FILE_NAME))
    }

    /// El cliente de este `client_id` (o por qué no se acepta).
    pub async fn resolve(&self, client_id: &str, now: u64) -> Result<ClientInfo, String> {
        let Some(url) = clients::metadata_url(client_id) else {
            return lock(&self.registered)
                .clients
                .iter()
                .find(|c| c.client_id == client_id)
                .cloned()
                .ok_or_else(|| "SSHorus no conoce este cliente: tiene que registrarse otra vez.".into());
        };
        if let Some((c, at)) = lock(&self.cache).get(client_id)
            && now.saturating_sub(*at) < CACHE_MS
        {
            return Ok(c.clone());
        }
        let body = self.fetcher.fetch(&url).await?;
        let info = clients::from_metadata(client_id, &body)?;
        let mut cache = lock(&self.cache);
        cache.retain(|_, (_, at)| now.saturating_sub(*at) < CACHE_MS);
        if cache.len() >= CACHE_MAX {
            cache.clear();
        }
        cache.insert(client_id.to_string(), (info.clone(), now));
        Ok(info)
    }

    /// Registro dinámico: valida, le da un `client_id` y lo guarda.
    pub fn register(&self, req: RegistrationRequest) -> Result<ClientInfo, RegistrationError> {
        let id = token::random_hex(16).map_err(RegistrationError::server)?;
        let info = clients::register(req, format!("sshorus-{}", id.as_str()))?;
        let mut g = lock(&self.registered);
        let mut next = g.clone();
        next.clients.push(info.clone());
        let extra = next.clients.len().saturating_sub(KEEP_REGISTRATIONS);
        next.clients.drain(..extra);
        if let Some(p) = &self.path {
            fsutil::write_json_atomic(p, &next).map_err(RegistrationError::server)?;
        }
        *g = next;
        Ok(info)
    }
}
