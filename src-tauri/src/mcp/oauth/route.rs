//! Rutas HTTP de OAuth: leer la petición, llamar a la lógica (`authorize`, `grant`, `metadata`) y armar la
//! respuesta. Llegan ya filtradas por `http.rs` (solo 127.0.0.1, sin `Origin`, `Host` local comprobado).
//! Con SSHorus bloqueado o el MCP apagado no se autoriza ni se entrega nada.

use std::sync::Arc;

use bytes::Bytes;
use http::{header, HeaderValue, Method, Request, Response, StatusCode};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use serde_json::{json, Value};

use super::super::backend::Backend;
use super::super::core::{McpCore, DISABLED_MSG, LOCKED_MSG};
use super::super::http::{Body, Gate, MCP_PATH};
use super::super::pairing::PairContext;
use super::authorize::Outcome;
use super::form::Params;
use super::metadata::{self, Here};
use super::page;

/// Lo que puede ocupar el cuerpo de `/token`, `/register` o `/revoke`.
const MAX_BODY: usize = 16 * 1024;

/// ¿Es una ruta de OAuth?
pub fn owns(path: &str) -> bool {
    let prm_mcp = format!("{}{MCP_PATH}", metadata::PRM_PATH);
    [
        metadata::PRM_PATH,
        prm_mcp.as_str(),
        metadata::AS_PATH,
        metadata::AUTHORIZE_PATH,
        metadata::WAIT_PATH,
        metadata::TOKEN_PATH,
        metadata::REGISTER_PATH,
        metadata::REVOKE_PATH,
    ]
    .contains(&path)
}

fn with_headers(status: StatusCode, content_type: &'static str, body: Vec<u8>) -> Response<Body> {
    let mut r = Response::new(Full::new(Bytes::from(body)).boxed());
    *r.status_mut() = status;
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    r
}

fn json(status: StatusCode, v: &Value) -> Response<Body> {
    with_headers(status, "application/json", v.to_string().into_bytes())
}

fn html(status: StatusCode, body: String) -> Response<Body> {
    let mut r = with_headers(status, "text/html; charset=utf-8", body.into_bytes());
    r.headers_mut().insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(page::CSP));
    r.headers_mut().insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    r
}

fn outcome(o: Outcome) -> Response<Body> {
    match o {
        Outcome::Page(m) => html(StatusCode::BAD_REQUEST, page::error(&m)),
        Outcome::Redirect(to) => match HeaderValue::from_str(&to) {
            Ok(loc) => {
                let mut r = with_headers(StatusCode::FOUND, "text/plain; charset=utf-8", Vec::new());
                r.headers_mut().insert(header::LOCATION, loc);
                r
            }
            Err(_) => html(StatusCode::BAD_REQUEST, page::error("Dirección de vuelta no válida.")),
        },
    }
}

fn status(code: u16) -> StatusCode {
    StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST)
}

fn query(req: &Request<Incoming>) -> Option<Params> {
    Params::parse(req.uri().query().unwrap_or(""))
}

async fn body(req: Request<Incoming>) -> Option<Bytes> {
    Limited::new(req.into_body(), MAX_BODY).collect().await.ok().map(|b| b.to_bytes())
}

/// Lo síncrono (huellas y disco) fuera del hilo async. None si la tarea se cayó.
async fn blocking<T: Send + 'static>(gate: &Arc<dyn Gate>, f: impl FnOnce(&super::OAuth) -> T + Send + 'static) -> Option<T> {
    let g = gate.clone();
    tokio::task::spawn_blocking(move || g.oauth().map(f)).await.ok().flatten()
}

/// Por qué no se puede autorizar ahora (bloqueado o apagado).
fn unavailable<B: Backend>(core: &McpCore<B>, gate: &dyn Gate) -> Option<&'static str> {
    if gate.locked() {
        Some(LOCKED_MSG)
    } else if !core.config.get().enabled {
        Some(DISABLED_MSG)
    } else {
        None
    }
}

pub async fn handle<B: Backend>(req: Request<Incoming>, here: Here, core: &Arc<McpCore<B>>, gate: &Arc<dyn Gate>) -> Response<Body> {
    let Some(oauth) = gate.oauth() else { return json(StatusCode::NOT_FOUND, &json!({ "error": "not_found" })) };
    let path = req.uri().path().to_string();
    if path.starts_with(metadata::PRM_PATH) {
        return json(StatusCode::OK, &metadata::protected_resource(&here));
    }
    if path == metadata::AS_PATH {
        return json(StatusCode::OK, &metadata::authorization_server(&here));
    }
    if let Some(why) = unavailable(core, gate.as_ref()) {
        return match path.as_str() {
            metadata::AUTHORIZE_PATH | metadata::WAIT_PATH => html(StatusCode::SERVICE_UNAVAILABLE, page::error(why)),
            _ => json(StatusCode::SERVICE_UNAVAILABLE, &json!({ "error": "temporarily_unavailable", "error_description": why })),
        };
    }
    let bad = |m: &str| json(StatusCode::BAD_REQUEST, &json!({ "error": "invalid_request", "error_description": m }));
    match (req.method().clone(), path.as_str()) {
        (Method::GET, metadata::AUTHORIZE_PATH) => {
            let Some(q) = query(&req) else { return html(StatusCode::BAD_REQUEST, page::error("Petición mal formada.")) };
            let browser = req.headers().get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            match oauth.begin(&q, &here, &browser).await {
                Ok(id) => html(StatusCode::OK, page::waiting(&id)),
                Err(o) => outcome(o),
            }
        }
        (Method::GET, metadata::WAIT_PATH) => {
            let Some(id) = query(&req).and_then(|q| q.get("id").map(str::to_string)) else {
                return html(StatusCode::BAD_REQUEST, page::error("Petición mal formada."));
            };
            let servers = core.backend.profiles().servers.into_iter().map(|s| (s.id, s.name)).collect();
            let locked = || gate.locked();
            let ctx = PairContext { audit: &core.audit, servers, locked: &locked };
            outcome(oauth.finish(&id, &ctx).await)
        }
        (Method::POST, metadata::TOKEN_PATH) => {
            let Some(p) = body(req).await.and_then(|b| Params::parse(&String::from_utf8_lossy(&b))) else {
                return bad("cuerpo no válido");
            };
            let core = core.clone();
            match blocking(gate, move |o| o.token(&p, &core.audit)).await {
                Some(Ok(t)) => json(StatusCode::OK, &t.to_json()),
                Some(Err(e)) => json(status(e.status()), &e.to_json()),
                None => json(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": "server_error" })),
            }
        }
        (Method::POST, metadata::REGISTER_PATH) => {
            let Some(b) = body(req).await else { return bad("cuerpo demasiado grande") };
            match blocking(gate, move |o| o.register(&b)).await {
                Some(Ok(v)) => json(StatusCode::CREATED, &v),
                Some(Err(e)) => json(StatusCode::BAD_REQUEST, &json!({ "error": e.code, "error_description": e.description })),
                None => json(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": "server_error" })),
            }
        }
        (Method::POST, metadata::REVOKE_PATH) => {
            let Some(p) = body(req).await.and_then(|b| Params::parse(&String::from_utf8_lossy(&b))) else {
                return bad("cuerpo no válido");
            };
            let core = core.clone();
            blocking(gate, move |o| o.revoke(&p, &core.audit)).await;
            json(StatusCode::OK, &json!({}))
        }
        _ => json(StatusCode::METHOD_NOT_ALLOWED, &json!({ "error": "invalid_request", "error_description": "método no permitido" })),
    }
}
