//! `POST /pair`: la petición del puente. Solo llega desde 127.0.0.1 y sin cabecera `Origin` (lo comprueba
//! `http.rs` para todas las rutas). Con SSHorus bloqueado o el MCP apagado se rechaza sin mostrar nada.
//! La respuesta tarda lo que tardes en decidir (hasta 2 min): el puente se queda esperando.

use bytes::Bytes;
use http::{Request, Response, StatusCode};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;

use super::super::backend::Backend;
use super::super::bridge::wire::{PairOutcome, PairReply, PairRequest};
use super::super::core::{McpCore, DISABLED_MSG, LOCKED_MSG};
use super::super::http::{Body, Gate};
use super::PairContext;

/// Lo que puede ocupar una petición (unos pocos textos).
const MAX_BODY: usize = 16 * 1024;

fn json_reply(reply: &PairReply) -> Response<Body> {
    let body = serde_json::to_vec(reply).unwrap_or_default();
    let mut r = Response::new(Full::new(Bytes::from(body)).boxed());
    *r.status_mut() = StatusCode::from_u16(reply.http_status()).unwrap_or(StatusCode::BAD_REQUEST);
    r.headers_mut()
        .insert(http::header::CONTENT_TYPE, http::HeaderValue::from_static("application/json"));
    r
}

pub async fn handle<B: Backend>(req: Request<Incoming>, core: &McpCore<B>, gate: &dyn Gate) -> Response<Body> {
    let invalid = |m: &str| json_reply(&PairReply::new(PairOutcome::Invalid, m));
    if req.method() != http::Method::POST {
        return invalid("Usa POST /pair.");
    }
    let Some(pairing) = gate.pairing() else { return invalid("Esta versión de SSHorus no empareja asistentes.") };
    if gate.locked() {
        return json_reply(&PairReply::new(PairOutcome::Locked, LOCKED_MSG));
    }
    if !core.config.get().enabled {
        return json_reply(&PairReply::new(PairOutcome::Rejected, DISABLED_MSG));
    }
    let body = match Limited::new(req.into_body(), MAX_BODY).collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => return invalid("Petición demasiado grande."),
    };
    let Ok(request) = serde_json::from_slice::<PairRequest>(&body) else {
        return invalid("Petición de emparejado no válida.");
    };
    let servers = core.backend.profiles().servers.into_iter().map(|s| (s.id, s.name)).collect();
    let locked = || gate.locked();
    let ctx = PairContext { audit: &core.audit, servers, locked: &locked };
    json_reply(&pairing.request(request, &ctx).await)
}
