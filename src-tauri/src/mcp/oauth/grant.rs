//! `/token` y `/revoke`, sin HTTP (eso es `route.rs`). Calculan huellas y escriben en disco: se llaman
//! fuera del hilo async.
//!
//! - `authorization_code`: el código vale una vez y 60 s, para el mismo cliente, la misma dirección de vuelta
//!   (si se mandó al pedirlo) y con el verificador PKCE. Si alguien repite un código ya canjeado, se revoca
//!   lo que se dio con él.
//! - `refresh_token`: cada token de renovación vale una vez; la respuesta trae otro (rotación).
//! - Revocar el de renovación desconecta al asistente (como «Revocar» en SSHorus); revocar uno de acceso
//!   solo quita ese.

use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::super::audit::{now_ms, AuditLog};
use super::super::pairing::model::OAuthLink;
use super::super::pairing::registry::TokenCheck;
use super::super::pairing::token::{self, Kind};
use super::super::pairing::{journal_oauth, Auth};
use super::form::Params;
use super::metadata::same_resource;
use super::store::{CodeUse, ACCESS_SECS};
use super::{lock, pkce, OAuth};

/// Error de `/token` (RFC 6749 §5.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenError {
    pub code: &'static str,
    pub description: String,
}

impl TokenError {
    fn new(code: &'static str, description: impl Into<String>) -> Self {
        TokenError { code, description: description.into() }
    }

    pub fn status(&self) -> u16 {
        if self.code == "invalid_client" { 401 } else { 400 }
    }

    pub fn to_json(&self) -> Value {
        json!({ "error": self.code, "error_description": self.description })
    }
}

/// Tokens entregados (solo viajan en esta respuesta).
pub struct Tokens {
    pub access: Zeroizing<String>,
    pub refresh: Zeroizing<String>,
    pub scope: Option<String>,
}

impl Tokens {
    pub fn to_json(&self) -> Value {
        let mut v = json!({
            "access_token": self.access.as_str(),
            "token_type": "Bearer",
            "expires_in": ACCESS_SECS,
            "refresh_token": self.refresh.as_str(),
        });
        if let Some(s) = &self.scope {
            v["scope"] = json!(s);
        }
        v
    }
}

fn need<'a>(p: &'a Params, key: &str) -> Result<&'a str, TokenError> {
    p.get(key).ok_or_else(|| TokenError::new("invalid_request", format!("falta {key}")))
}

fn server_error(e: impl std::fmt::Display) -> TokenError {
    TokenError::new("server_error", e.to_string())
}

impl OAuth {
    pub fn token(&self, p: &Params, audit: &AuditLog) -> Result<Tokens, TokenError> {
        match need(p, "grant_type")? {
            "authorization_code" => self.exchange(p, audit),
            "refresh_token" => self.refresh(p, audit),
            _ => Err(TokenError::new("unsupported_grant_type", "solo authorization_code y refresh_token")),
        }
    }

    fn exchange(&self, p: &Params, audit: &AuditLog) -> Result<Tokens, TokenError> {
        let (code, client_id) = (need(p, "code")?, need(p, "client_id")?);
        let verifier = need(p, "code_verifier")?;
        let used = lock(&self.store).take_code(code, now_ms());
        let g = match used {
            CodeUse::Valid(g) => g,
            CodeUse::Reused(issued_to) => {
                if let Some(id) = issued_to
                    && let Ok(c) = self.pairing.registry().revoke(&id, now_ms())
                {
                    journal_oauth(audit, &c.id, &c.name, false, "Repitió un código ya canjeado: se revocó por seguridad.");
                    self.pairing.notify_changed();
                }
                return Err(TokenError::new("invalid_grant", "el código ya se usó"));
            }
            CodeUse::Unknown => return Err(TokenError::new("invalid_grant", "código no válido o caducado")),
        };
        let fail = |why: &str| {
            journal_oauth(audit, &g.applicant.client_id, &g.applicant.name, false, format!("Canje rechazado: {why}."));
            Err(TokenError::new("invalid_grant", why))
        };
        if g.client_id != client_id {
            return fail("el código es de otro cliente");
        }
        // RFC 6749 §4.1.3: obligatoria (e idéntica) solo si se mandó al pedir la autorización.
        match p.get("redirect_uri") {
            Some(r) if r != g.redirect_uri => return fail("la dirección de vuelta no coincide"),
            None if g.redirect_given => return fail("falta redirect_uri"),
            _ => {}
        }
        if !pkce::verify_s256(verifier, &g.code_challenge) {
            return fail("el verificador PKCE no coincide");
        }
        if p.get("resource").is_some_and(|r| !same_resource(r, &g.resource)) {
            return Err(TokenError::new("invalid_target", "el recurso no es el de la autorización"));
        }
        let link = OAuthLink { client_id: g.client_id.clone(), resource: g.resource.clone() };
        let (refresh, client) = self.pairing.issue(&g.applicant, g.access.clone(), Some(link)).map_err(server_error)?;
        let access = lock(&self.store).add_access(&client.kid, &g.resource, now_ms()).map_err(server_error)?;
        lock(&self.store).code_redeemed(code, &client.id);
        journal_oauth(audit, &client.id, &client.name, true, "Canjeó su código: conectado por OAuth.");
        Ok(Tokens { access, refresh, scope: g.scope.clone() })
    }

    fn refresh(&self, p: &Params, audit: &AuditLog) -> Result<Tokens, TokenError> {
        let (tok, client_id) = (need(p, "refresh_token")?, need(p, "client_id")?);
        let resource = p.get("resource");
        let Some(kid) = token::kid_of(tok, Kind::Refresh) else {
            return Err(TokenError::new("invalid_grant", "token de renovación no válido"));
        };
        let next = token::issue(Kind::Refresh, kid).map_err(server_error)?;
        let now = now_ms();
        let accept = |c: &super::super::pairing::model::PairedClient| {
            c.oauth.as_ref().is_some_and(|o| o.client_id == client_id && resource.is_none_or(|r| same_resource(r, &o.resource)))
        };
        let check = self.pairing.registry().rotate(tok, next.hash, now, accept).map_err(server_error)?;
        match check {
            TokenCheck::Valid(c) => {
                let resource = c.oauth.as_ref().map(|o| o.resource.clone()).unwrap_or_default();
                let access = lock(&self.store).add_access(&c.kid, &resource, now).map_err(server_error)?;
                Ok(Tokens { access, refresh: next.token, scope: p.get("scope").map(str::to_string) })
            }
            revoked @ TokenCheck::Revoked(_) => {
                let why = match self.pairing.auth_of(revoked, audit, now) {
                    Auth::Revoked(m) => m,
                    _ => "revocado".into(),
                };
                Err(TokenError::new("invalid_grant", why))
            }
            TokenCheck::Unknown => {
                if self.pairing.registry().should_log_failure(&format!("refresh:{kid}"), now) {
                    journal_oauth(audit, client_id, "cliente OAuth", false, "Token de renovación no válido o ya usado.");
                }
                Err(TokenError::new("invalid_grant", "token de renovación no válido o ya usado"))
            }
        }
    }

    /// `POST /revoke` (RFC 7009): siempre «bien», aunque el token no exista.
    pub fn revoke(&self, p: &Params, audit: &AuditLog) {
        let Some(tok) = p.get("token") else { return };
        match token::parse(tok).map(|(k, _)| k) {
            Some(Kind::Access) => lock(&self.store).drop_access(tok),
            Some(Kind::Refresh) => {
                let TokenCheck::Valid(c) = self.pairing.registry().check(tok, Kind::Refresh, now_ms()) else { return };
                let same_client = p.get("client_id").is_none_or(|id| c.oauth.as_ref().is_some_and(|o| o.client_id == id));
                if same_client && self.pairing.registry().revoke(&c.id, now_ms()).is_ok() {
                    journal_oauth(audit, &c.id, &c.name, true, "El asistente cerró su conexión (revocó su token).");
                    self.pairing.notify_changed();
                }
            }
            _ => {}
        }
    }
}
