//! Transporte HTTP «streamable» local: solo `127.0.0.1`, rutas `/mcp` (con token) y `/pair`
//! (emparejar un asistente, ver `pairing::route`).
//!
//! Antes de llegar al SDK, cada petición pasa por aquí:
//! 1. Con cabecera `Origin` (una página web) → 403. Ningún cliente MCP de escritorio la manda.
//! 2. Si SSHorus está bloqueado → error JSON-RPC «SSHorus está bloqueado: desbloquéalo para
//!    continuar» (sin bóveda abierta tampoco se puede leer el token para comprobarlo).
//! 3. `Authorization: Bearer <token>`: el token general o el de un asistente emparejado (`tvc_…`),
//!    comparados en tiempo constante → si no, 401. Quién es queda en la petición (`Caller`): con eso
//!    `McpCore` aplica los permisos de ese asistente.
//!
//! El SDK (`rmcp`) va sin sesiones y responde en JSON: cada petición es independiente, así el
//! puente stdio solo tiene que reenviar mensajes.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http::{Request, Response, StatusCode};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use rmcp::transport::{StreamableHttpServerConfig, StreamableHttpService};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tower_service::Service;
use zeroize::Zeroizing;

use super::backend::Backend;
use super::bridge::wire::PAIR_PATH;
use super::caller::Caller;
use super::core::{McpCore, LOCKED_MSG};
use super::pairing::{self, token, Auth, Pairing};
use super::server::SshorusMcp;

pub const MCP_PATH: &str = "/mcp";
/// Tamaño máximo de una petición (el contenido de `write_file` va dentro).
const MAX_BODY: usize = 4 * 1024 * 1024;
const WRONG_TOKEN_MSG: &str =
    "Token incorrecto o ausente: empareja el asistente con «sshorus-mcp pair» o copia la configuración de SSHorus → Ajustes → Asistentes de IA (MCP)";

pub type Body = BoxBody<Bytes, Infallible>;

/// Lo que el transporte necesita saber del estado de SSHorus.
pub trait Gate: Send + Sync + 'static {
    /// SSHorus está bloqueado.
    fn locked(&self) -> bool;
    /// Token general esperado (None = no hay token configurado o no se pudo leer).
    fn token(&self) -> Option<Zeroizing<String>>;
    /// Asistentes emparejados (None = esta puerta no empareja: `/pair` no existe y solo vale el token general).
    fn pairing(&self) -> Option<&Pairing> {
        None
    }
}

/// Compara sin cortar en la primera diferencia (no da pistas por el tiempo).
pub fn same_token(a: &str, b: &str) -> bool {
    token::constant_time_eq(a.as_bytes(), b.as_bytes())
}

fn text_response(status: StatusCode, msg: &str) -> Response<Body> {
    let body = json!({ "error": msg }).to_string();
    let mut r = Response::new(Full::new(Bytes::from(body)).boxed());
    *r.status_mut() = status;
    r.headers_mut()
        .insert(http::header::CONTENT_TYPE, http::HeaderValue::from_static("application/json"));
    r
}

/// Respuesta JSON-RPC de error para cada petición del cuerpo (o 202 si solo hay notificaciones).
fn jsonrpc_error_response(body: &[u8], message: &str) -> Response<Body> {
    let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let one = |m: &Value| -> Option<Value> {
        let id = m.get("id")?;
        m.get("method")?;
        Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }))
    };
    let out: Vec<Value> = match &parsed {
        Value::Array(items) => items.iter().filter_map(one).collect(),
        Value::Null => vec![json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": message } })],
        m => one(m).into_iter().collect(),
    };
    if out.is_empty() {
        let mut r = Response::new(Full::new(Bytes::new()).boxed());
        *r.status_mut() = StatusCode::ACCEPTED;
        return r;
    }
    let body = if parsed.is_array() { Value::Array(out).to_string() } else { out[0].to_string() };
    let mut r = Response::new(Full::new(Bytes::from(body)).boxed());
    r.headers_mut()
        .insert(http::header::CONTENT_TYPE, http::HeaderValue::from_static("application/json"));
    r
}

fn bearer(req: &Request<Incoming>) -> Option<&str> {
    let v = req.headers().get(http::header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = v.trim().split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then_some(token.trim())
}

/// Servicio del SDK, sin sesiones y con respuestas JSON.
pub fn mcp_service<B: Backend>(
    core: Arc<McpCore<B>>,
    ct: CancellationToken,
) -> StreamableHttpService<SshorusMcp<B>, NeverSessionManager> {
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_sse_keep_alive(None)
        .with_max_request_body_bytes(MAX_BODY)
        .with_cancellation_token(ct);
    StreamableHttpService::new(
        move || Ok(SshorusMcp::new(core.clone())),
        Arc::new(NeverSessionManager::default()),
        config,
    )
}

/// Quién es el dueño del token de la petición (o por qué no vale: el texto del 401).
async fn authenticate<B: Backend>(req: &Request<Incoming>, core: &McpCore<B>, gate: &Arc<dyn Gate>) -> Result<Caller, String> {
    let given = bearer(req).unwrap_or("");
    if token::kid_of(given).is_some()
        && let Some(p) = gate.pairing()
    {
        return match p.authenticate(given, &core.audit) {
            Auth::Client(grant) => Ok(Caller::paired(grant)),
            Auth::Revoked(m) => Err(m),
            Auth::Unknown => Err(WRONG_TOKEN_MSG.into()),
        };
    }
    // Leer el token general puede tocar el llavero del sistema (bloqueante): fuera del hilo async.
    let g = gate.clone();
    let expected = tokio::task::spawn_blocking(move || g.token()).await.ok().flatten();
    match expected {
        Some(expected) if same_token(given, &expected) => Ok(Caller::default()),
        Some(_) => Err(WRONG_TOKEN_MSG.into()),
        // Con emparejado no hace falta token general: no se pide generarlo.
        None if gate.pairing().is_some() => Err(WRONG_TOKEN_MSG.into()),
        None => Err("SSHorus aún no tiene token para asistentes: genera uno en Ajustes → Asistentes de IA (MCP)".into()),
    }
}

async fn handle<B: Backend>(
    req: Request<Incoming>,
    svc: StreamableHttpService<SshorusMcp<B>, NeverSessionManager>,
    core: Arc<McpCore<B>>,
    gate: Arc<dyn Gate>,
) -> Result<Response<Body>, Infallible> {
    if req.headers().contains_key(http::header::ORIGIN) {
        return Ok(text_response(StatusCode::FORBIDDEN, "SSHorus no acepta peticiones de páginas web"));
    }
    match req.uri().path() {
        MCP_PATH => {}
        PAIR_PATH if gate.pairing().is_some() => return Ok(pairing::route::handle(req, &core, gate.as_ref()).await),
        _ => return Ok(text_response(StatusCode::NOT_FOUND, "Ruta desconocida: usa /mcp")),
    }
    if gate.locked() {
        if req.method() != http::Method::POST {
            return Ok(text_response(StatusCode::SERVICE_UNAVAILABLE, LOCKED_MSG));
        }
        let body = match Limited::new(req.into_body(), MAX_BODY).collect().await {
            Ok(b) => b.to_bytes(),
            Err(_) => return Ok(text_response(StatusCode::PAYLOAD_TOO_LARGE, "Petición demasiado grande")),
        };
        return Ok(jsonrpc_error_response(&body, LOCKED_MSG));
    }
    let mut req = req;
    match authenticate(&req, &core, &gate).await {
        Ok(caller) => {
            req.extensions_mut().insert(caller);
        }
        Err(why) => return Ok(text_response(StatusCode::UNAUTHORIZED, &why)),
    }
    let mut svc = svc;
    svc.call(req).await
}

/// Atiende conexiones hasta que `ct` se cancele.
pub async fn serve<B: Backend>(listener: TcpListener, core: Arc<McpCore<B>>, gate: Arc<dyn Gate>, ct: CancellationToken) {
    let svc = mcp_service(core.clone(), ct.child_token());
    loop {
        let (stream, peer) = tokio::select! {
            () = ct.cancelled() => break,
            r = listener.accept() => match r {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("MCP: no se pudo aceptar una conexión: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    continue;
                }
            },
        };
        if !is_loopback(&peer) {
            continue;
        }
        let (svc, core, gate) = (svc.clone(), core.clone(), gate.clone());
        let ct = ct.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req| handle(req, svc.clone(), core.clone(), gate.clone()));
            let conn = http1::Builder::new().serve_connection(TokioIo::new(stream), service);
            tokio::pin!(conn);
            let mut closing = false;
            loop {
                tokio::select! {
                    r = conn.as_mut() => {
                        if let Err(e) = r {
                            log::debug!("MCP: conexión terminada: {e}");
                        }
                        break;
                    }
                    () = ct.cancelled(), if !closing => {
                        closing = true;
                        conn.as_mut().graceful_shutdown();
                    }
                }
            }
        });
    }
}

fn is_loopback(addr: &SocketAddr) -> bool {
    addr.ip().is_loopback()
}
