//! Cliente de OSV.dev (https://api.osv.dev, sin cuenta ni token).
//!
//! Reglas de la API (probadas, PENDIENTES 10.2):
//! - `POST /v1/querybatch`: como mucho 1000 consultas; devuelve solo `id` y `modified` por paquete, en
//!   el mismo orden. Si una consulta pasa de 1000 resultados llega `next_page_token` y se repite SOLO
//!   esa consulta con el token.
//! - Un ecosistema inválido tumba el lote entero (`400`): entonces se reparte el lote por ecosistema
//!   para que los demás sigan.
//! - `GET /v1/vulns/{id}`: el detalle, que se guarda en la caché por `id` + `modified`.
//!
//! Solo se envía `{ecosistema, nombre, versión}`; nunca datos del servidor.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::cache::OsvCache;
use crate::error::{AppError, AppResult};

pub use super::osv_model::{cmp_versions, unique_ids, OsvVuln};

pub const BASE: &str = "https://api.osv.dev";
pub const MAX_BATCH: usize = 1000;
/// Rondas de paginación como máximo (cada una pide solo lo pendiente).
const MAX_ROUNDS: usize = 30;
const DETAIL_PARALLEL: usize = 8;
const DETAIL_TIMEOUT: Duration = Duration::from_secs(25);
const BATCH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BODY: u64 = 64 * 1024 * 1024;

/// Una consulta: lo único que viaja a OSV.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Query {
    pub ecosystem: String,
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Hit {
    pub id: String,
    #[serde(default)]
    pub modified: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct BatchItem {
    #[serde(default)]
    pub vulns: Vec<Hit>,
    #[serde(default)]
    pub next_page_token: Option<String>,
}

#[derive(Debug)]
pub enum OsvError {
    /// 400: consulta inválida (ecosistema desconocido, demasiadas consultas…).
    BadRequest(String),
    /// 404 al pedir un aviso.
    NotFound,
    Other(AppError),
}

impl From<OsvError> for AppError {
    fn from(e: OsvError) -> Self {
        match e {
            OsvError::BadRequest(m) => AppError::Invalid(format!("OSV rechazó la consulta: {m}")),
            OsvError::NotFound => AppError::NotFound("ese aviso en OSV".into()),
            OsvError::Other(e) => e,
        }
    }
}

/// Lo que hace falta de OSV (la red real o una falsa en pruebas).
pub trait OsvApi: Send + Sync {
    /// Una petición `querybatch` (≤ 1000). Cada consulta puede llevar su `page_token`.
    fn querybatch(&self, queries: &[(Query, Option<String>)]) -> impl Future<Output = Result<Vec<BatchItem>, OsvError>> + Send;
    fn vuln(&self, id: &str) -> impl Future<Output = Result<Value, OsvError>> + Send;
}

/// Cliente HTTPS real (reqwest + rustls). Solo habla con `api.osv.dev`.
pub struct HttpOsv {
    base: String,
}

impl Default for HttpOsv {
    fn default() -> Self {
        HttpOsv { base: BASE.to_string() }
    }
}

fn client() -> AppResult<&'static Client> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = Client::builder()
        .user_agent("SSHorus")
        .connect_timeout(Duration::from_secs(10))
        .https_only(true)
        // Sin redirecciones: el host es fijo.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Network(format!("no se pudo preparar la conexión segura: {e}")))?;
    Ok(CLIENT.get_or_init(|| c))
}

fn net_err(e: reqwest::Error) -> OsvError {
    if e.is_timeout() {
        OsvError::Other(AppError::Network("OSV.dev no respondió a tiempo".into()))
    } else {
        OsvError::Other(AppError::Network(format!("no se pudo hablar con OSV.dev: {}", e.without_url())))
    }
}

async fn read_body(resp: reqwest::Response) -> Result<(StatusCode, Vec<u8>), OsvError> {
    let status = resp.status();
    if resp.content_length().is_some_and(|n| n > MAX_BODY) {
        return Err(OsvError::Other(AppError::Network("respuesta de OSV demasiado grande".into())));
    }
    let body = resp.bytes().await.map_err(net_err)?;
    if body.len() as u64 > MAX_BODY {
        return Err(OsvError::Other(AppError::Network("respuesta de OSV demasiado grande".into())));
    }
    Ok((status, body.to_vec()))
}

fn status_err(status: StatusCode, body: &[u8]) -> OsvError {
    let msg = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_else(|| String::from_utf8_lossy(body).chars().take(200).collect());
    match status {
        StatusCode::BAD_REQUEST => OsvError::BadRequest(msg),
        StatusCode::NOT_FOUND => OsvError::NotFound,
        s => OsvError::Other(AppError::Network(format!("OSV.dev respondió {s}: {msg}"))),
    }
}

#[derive(Serialize)]
struct BatchBody<'a> {
    queries: Vec<BatchQuery<'a>>,
}

#[derive(Serialize)]
struct BatchQuery<'a> {
    package: BatchPkg<'a>,
    version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_token: Option<&'a str>,
}

#[derive(Serialize)]
struct BatchPkg<'a> {
    ecosystem: &'a str,
    name: &'a str,
}

#[derive(Deserialize)]
struct BatchResp {
    #[serde(default)]
    results: Vec<BatchItem>,
}

impl OsvApi for HttpOsv {
    async fn querybatch(&self, queries: &[(Query, Option<String>)]) -> Result<Vec<BatchItem>, OsvError> {
        let body = BatchBody {
            queries: queries
                .iter()
                .map(|(q, t)| BatchQuery {
                    package: BatchPkg { ecosystem: &q.ecosystem, name: &q.name },
                    version: &q.version,
                    page_token: t.as_deref(),
                })
                .collect(),
        };
        let resp = client()
            .map_err(OsvError::Other)?
            .post(format!("{}/v1/querybatch", self.base))
            .timeout(BATCH_TIMEOUT)
            .json(&body)
            .send()
            .await
            .map_err(net_err)?;
        let (status, body) = read_body(resp).await?;
        if !status.is_success() {
            return Err(status_err(status, &body));
        }
        let r: BatchResp = serde_json::from_slice(&body)
            .map_err(|e| OsvError::Other(AppError::Invalid(format!("respuesta de OSV inesperada: {e}"))))?;
        if r.results.len() != queries.len() {
            return Err(OsvError::Other(AppError::Invalid("OSV devolvió un número de resultados distinto al pedido".into())));
        }
        Ok(r.results)
    }

    async fn vuln(&self, id: &str) -> Result<Value, OsvError> {
        // El id va en la ruta: solo caracteres seguros (los ids de OSV llevan letras, números, «-», «:», «.», «_»).
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ':' | '.' | '_')) {
            return Err(OsvError::BadRequest(format!("id no válido: {id}")));
        }
        let resp = client()
            .map_err(OsvError::Other)?
            .get(format!("{}/v1/vulns/{id}", self.base))
            .timeout(DETAIL_TIMEOUT)
            .send()
            .await
            .map_err(net_err)?;
        let (status, body) = read_body(resp).await?;
        if !status.is_success() {
            return Err(status_err(status, &body));
        }
        serde_json::from_slice(&body).map_err(|e| OsvError::Other(AppError::Invalid(format!("aviso de OSV inesperado: {e}"))))
    }
}

/// Resultado de consultar todo: los ids de cada consulta (mismo orden) y los avisos del proceso.
#[derive(Debug, Default)]
pub struct BatchOutcome {
    pub hits: Vec<Vec<Hit>>,
    /// Ecosistemas que OSV rechazó (sus consultas quedan sin resultado).
    pub rejected: BTreeSet<String>,
    pub requests: usize,
}

/// Consulta todas las `queries` en lotes de 1000, con paginación y reparto por ecosistema si OSV
/// rechaza un lote. Error solo si OSV no responde (red).
pub async fn query_all<A: OsvApi>(api: &A, queries: &[Query], cancel: &CancellationToken) -> AppResult<BatchOutcome> {
    let mut out = BatchOutcome { hits: vec![Vec::new(); queries.len()], ..Default::default() };
    let mut pending: Vec<(usize, Option<String>)> = (0..queries.len()).map(|i| (i, None)).collect();
    let mut rounds = 0;
    while !pending.is_empty() && rounds < MAX_ROUNDS {
        rounds += 1;
        let mut next: Vec<(usize, Option<String>)> = Vec::new();
        for chunk in pending.chunks(MAX_BATCH) {
            if cancel.is_cancelled() {
                return Err(AppError::Canceled);
            }
            run_chunk(api, queries, chunk, &mut out, &mut next, true).await?;
        }
        pending = next;
    }
    Ok(out)
}

async fn run_chunk<A: OsvApi>(
    api: &A,
    queries: &[Query],
    chunk: &[(usize, Option<String>)],
    out: &mut BatchOutcome,
    next: &mut Vec<(usize, Option<String>)>,
    may_split: bool,
) -> AppResult<()> {
    let body: Vec<(Query, Option<String>)> = chunk.iter().map(|(i, t)| (queries[*i].clone(), t.clone())).collect();
    out.requests += 1;
    match api.querybatch(&body).await {
        Ok(items) => {
            for ((i, _), item) in chunk.iter().zip(items) {
                out.hits[*i].extend(item.vulns);
                if let Some(t) = item.next_page_token.filter(|t| !t.is_empty()) {
                    next.push((*i, Some(t)));
                }
            }
            Ok(())
        }
        Err(OsvError::BadRequest(msg)) => {
            let ecos: BTreeSet<&str> = chunk.iter().map(|(i, _)| queries[*i].ecosystem.as_str()).collect();
            if may_split && ecos.len() > 1 {
                for eco in ecos {
                    let part: Vec<(usize, Option<String>)> =
                        chunk.iter().filter(|(i, _)| queries[*i].ecosystem == eco).cloned().collect();
                    Box::pin(run_chunk(api, queries, &part, out, next, false)).await?;
                }
                Ok(())
            } else {
                log::warn!("OSV rechazó un lote ({msg})");
                for e in ecos {
                    out.rejected.insert(e.to_string());
                }
                Ok(())
            }
        }
        Err(OsvError::NotFound) => Ok(()),
        Err(OsvError::Other(e)) => Err(e),
    }
}

/// Pide el detalle de cada id (caché primero), 8 a la vez. Devuelve los que se pudieron leer y
/// cuántos fallaron. `progress(hechos, total)`.
pub async fn fetch_details<A: OsvApi>(
    api: &A,
    cache: &OsvCache,
    ids: &[(String, String)],
    cancel: &CancellationToken,
    progress: &(dyn Fn(usize, usize) + Send + Sync),
) -> AppResult<(HashMap<String, OsvVuln>, usize)> {
    let total = ids.len();
    let mut out = HashMap::new();
    let mut failed = 0usize;
    let mut todo: Vec<(String, String)> = Vec::new();
    for (id, modified) in ids {
        match cache.get(id, Some(modified).filter(|m| !m.is_empty()).map(String::as_str)) {
            Some(v) => {
                if let Ok(x) = serde_json::from_value::<OsvVuln>(v) {
                    out.insert(id.clone(), x);
                }
            }
            None => todo.push((id.clone(), modified.clone())),
        }
    }
    let cached = out.len();
    progress(cached, total);
    let mut done = cached;
    let mut net_failed = 0usize;
    let mut s = stream::iter(todo.into_iter().map(|(id, modified)| async move {
        // Hasta 3 intentos si falla la red o OSV responde 5xx/429 (pasa a veces con 8 a la vez).
        let mut r = api.vuln(&id).await;
        for wait in [600u64, 1500] {
            if !matches!(r, Err(OsvError::Other(_))) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(wait)).await;
            r = api.vuln(&id).await;
        }
        if let Err(e) = &r {
            log::warn!("OSV: no se pudo leer {id}: {e:?}");
        }
        (id, modified, r)
    }))
    .buffer_unordered(DETAIL_PARALLEL);
    loop {
        let next = tokio::select! {
            () = cancel.cancelled() => return Err(AppError::Canceled),
            n = s.next() => n,
        };
        let Some((id, modified, r)) = next else { break };
        done += 1;
        match r {
            Ok(v) => {
                let m = v.get("modified").and_then(|m| m.as_str()).map(str::to_string).unwrap_or(modified);
                cache.put(&id, &m, &v);
                if let Ok(x) = serde_json::from_value::<OsvVuln>(v) {
                    out.insert(id, x);
                } else {
                    failed += 1;
                }
            }
            Err(OsvError::Other(e)) if matches!(e, AppError::Network(_)) => {
                failed += 1;
                net_failed += 1;
                // Las primeras peticiones fallan todas por la red: OSV no está disponible.
                if net_failed >= DETAIL_PARALLEL && out.len() == cached {
                    return Err(e);
                }
            }
            Err(_) => failed += 1,
        }
        if done % 8 == 0 || done == total {
            progress(done, total);
        }
    }
    Ok((out, failed))
}
