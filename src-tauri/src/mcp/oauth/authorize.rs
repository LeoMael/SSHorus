//! `/authorize` en dos pasos, sin HTTP (eso es `route.rs`):
//! 1. `begin`: valida la petición. Si el cliente o su dirección de vuelta no valen, NO se vuelve a él (se
//!    muestra una página); cualquier otro error vuelve a su dirección con `error=…` (RFC 6749 §4.1.2.1).
//!    Si todo vale, se guarda y el navegador muestra la página de espera.
//! 2. `finish`: la página de espera llega aquí; se muestra el diálogo de emparejado y, según tu respuesta,
//!    se vuelve al cliente con un código o con `error=access_denied`.

use super::super::audit::{now_ms, AuditStatus};
use super::super::bridge::wire::PairOutcome;
use super::super::pairing::applicant::{clip, Applicant};
use super::super::pairing::consent::Consent;
use super::super::pairing::model::{Fact, Via};
use super::super::pairing::{grants, grants_text, PairContext};
use super::clients::Source;
use super::form::Params;
use super::metadata::{same_resource, Here};
use super::store::{AuthRequest, CodeGrant, CODE_MS, REQUEST_MS};
use super::{lock, pkce, redirect, OAuth};

/// Largo máximo de `state` y `scope` (se devuelven tal cual).
const MAX_ECHO: usize = 1024;

/// Qué responde el navegador.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Una página con este mensaje (no se puede o no se debe volver al cliente).
    Page(String),
    /// Volver al cliente (dirección completa, con código o error).
    Redirect(String),
}

/// Vuelve al cliente con un error (y su `state`, y quién responde: RFC 9207).
fn error_back(uri: &str, state: Option<&str>, issuer: &str, error: &str, description: &str) -> Outcome {
    let mut p = vec![("error", error), ("error_description", description)];
    if let Some(s) = state {
        p.push(("state", s));
    }
    p.push(("iss", issuer));
    Outcome::Redirect(redirect::with_params(uri, &p))
}

fn applicant(r: &AuthRequest) -> Option<Applicant> {
    let mut a = Applicant::new(&format!("{}-http", r.client.name), &r.client.name, Via::OAuth)?;
    a.program = r.client.client_id.clone();
    let identity = match &r.client.source {
        Source::Metadata { host } => format!("comprobada: su ficha está publicada en {host}"),
        Source::Registered => "se registró sola en este equipo (sin comprobar)".into(),
    };
    a.facts = vec![
        Fact::new("Conexión", "HTTP directo (OAuth)"),
        Fact::new("Identidad", identity),
        Fact::new("Navegador", clip(&r.browser, 160)),
        Fact::new("Vuelve a", r.redirect_uri.clone()),
    ];
    Some(a)
}

impl OAuth {
    /// Valida la petición y la guarda; devuelve el id para la página de espera.
    pub async fn begin(&self, q: &Params, here: &Here, browser: &str) -> Result<String, Outcome> {
        let page = |m: &str| Outcome::Page(m.to_string());
        let client_id = q.get("client_id").ok_or_else(|| page("Falta client_id: vuelve a tu asistente e inténtalo otra vez."))?;
        let client = self.directory.resolve(client_id, now_ms()).await.map_err(|m| page(&m))?;
        let redirect_uri = match q.get("redirect_uri") {
            Some(r) => r.to_string(),
            None if client.redirect_uris.len() == 1 => client.redirect_uris[0].clone(),
            None => return Err(page("Falta redirect_uri.")),
        };
        if !redirect::allowed(&redirect_uri, &client.redirect_uris) {
            return Err(page("La dirección de vuelta no es una de las que registró el cliente (o no es de este equipo)."));
        }
        let state = q.get("state");
        let back = |error: &str, description: &str| error_back(&redirect_uri, state, here.issuer(), error, description);
        if state.is_some_and(|s| s.len() > MAX_ECHO) || q.get("scope").is_some_and(|s| s.len() > MAX_ECHO) {
            return Err(back("invalid_request", "state o scope demasiado largos"));
        }
        if q.get("response_type") != Some("code") {
            return Err(back("unsupported_response_type", "solo response_type=code"));
        }
        let challenge = q.get("code_challenge").filter(|c| pkce::valid_challenge(c));
        let (Some(challenge), Some(pkce::METHOD)) = (challenge, q.get("code_challenge_method")) else {
            return Err(back("invalid_request", "PKCE obligatorio: code_challenge con code_challenge_method=S256"));
        };
        let resource = here.resource();
        if q.get("resource").is_some_and(|r| !same_resource(r, &resource)) {
            return Err(back("invalid_target", "el recurso pedido no es este servidor MCP"));
        }
        let request = AuthRequest {
            client,
            redirect_uri: redirect_uri.clone(),
            code_challenge: challenge.to_string(),
            state: state.map(str::to_string),
            resource,
            scope: q.get("scope").map(str::to_string),
            browser: browser.to_string(),
            issuer: here.issuer().to_string(),
            expires_at: now_ms() + REQUEST_MS,
        };
        lock(&self.store).put_request(request, now_ms()).map_err(|e| back("temporarily_unavailable", &e.to_string()))
    }

    /// Muestra el diálogo y dice a dónde vuelve el navegador.
    pub async fn finish(&self, id: &str, ctx: &PairContext<'_>) -> Outcome {
        let Some(r) = lock(&self.store).take_request(id, now_ms()) else {
            return Outcome::Page("Esta petición ya terminó o caducó. Vuelve a tu asistente e inténtalo otra vez.".into());
        };
        let back = |error: &str, description: &str| error_back(&r.redirect_uri, r.state.as_deref(), &r.issuer, error, description);
        let Some(a) = applicant(&r) else { return back("invalid_request", "nombre de cliente no válido") };
        let (access, record) = match self.pairing.consent(&a, ctx).await {
            Consent::Accepted { access, record } => (access, record),
            Consent::Refused(reply) => {
                let error = if reply.outcome == PairOutcome::Busy { "temporarily_unavailable" } else { "access_denied" };
                return back(error, &reply.message);
            }
        };
        let summary = grants_text(&grants(&access, &ctx.servers));
        let grant = CodeGrant {
            client_id: r.client.client_id.clone(),
            redirect_uri: r.redirect_uri.clone(),
            code_challenge: r.code_challenge.clone(),
            resource: r.resource.clone(),
            scope: r.scope.clone(),
            applicant: a,
            access,
            expires_at: now_ms() + CODE_MS,
        };
        let put = lock(&self.store).put_code(grant, now_ms());
        match put {
            Ok(code) => {
                record.finish(AuditStatus::Ok, "tú: aceptado", format!("Permisos: {summary}. Por OAuth: código entregado."));
                let mut p = vec![("code", code.as_str())];
                if let Some(s) = r.state.as_deref() {
                    p.push(("state", s));
                }
                p.push(("iss", r.issuer.as_str()));
                Outcome::Redirect(redirect::with_params(&r.redirect_uri, &p))
            }
            Err(e) => {
                record.finish(AuditStatus::Error, "tú: aceptado", e.to_string());
                back("server_error", &e.to_string())
            }
        }
    }
}
