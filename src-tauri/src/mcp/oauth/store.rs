//! Lo que OAuth guarda solo en memoria, con el reloj que se le pasa (puro): peticiones de autorización que
//! esperan a la página, códigos (60 s, un solo uso) y tokens de acceso (1 h). De códigos y tokens solo se
//! guarda la huella. Tras reiniciar SSHorus el cliente renueva con su token de renovación, que sí se guarda
//! (como huella) en la ficha del asistente.

use std::collections::{BTreeMap, HashMap};

use zeroize::Zeroizing;

use super::super::pairing::applicant::Applicant;
use super::super::pairing::token::{self, Kind, TokenHash};
use super::super::policy::Access;
use super::clients::ClientInfo;
use crate::error::{AppError, AppResult};

/// Lo que espera una petición de autorización a que el navegador llegue a la página de espera.
pub const REQUEST_MS: u64 = 5 * 60 * 1000;
pub const CODE_MS: u64 = 60 * 1000;
pub const ACCESS_SECS: u64 = 60 * 60;
const MAX_REQUESTS: usize = 16;
const MAX_CODES: usize = 16;
/// Tokens de acceso vivos por asistente (los anteriores siguen valiendo hasta caducar, por si el cliente
/// tiene peticiones en curso al renovar).
const ACCESS_PER_CLIENT: usize = 8;
const ID_TRIES: usize = 16;

/// Una petición de `/authorize` ya validada.
#[derive(Debug, Clone)]
pub struct AuthRequest {
    pub client: ClientInfo,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub state: Option<String>,
    pub resource: String,
    pub scope: Option<String>,
    /// User-Agent del navegador (lo ve el diálogo).
    pub browser: String,
    pub issuer: String,
    pub expires_at: u64,
}

/// Lo que da un código al canjearlo.
#[derive(Debug, Clone)]
pub struct CodeGrant {
    pub client_id: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub resource: String,
    pub scope: Option<String>,
    pub applicant: Applicant,
    pub access: BTreeMap<String, Access>,
    pub expires_at: u64,
}

struct StoredCode {
    hash: TokenHash,
    grant: CodeGrant,
}

/// Un código ya canjeado (para reconocer si se intenta usar otra vez).
struct Used {
    expires_at: u64,
    /// Asistente que se creó con él.
    client: Option<String>,
}

struct AccessEntry {
    hash: TokenHash,
    resource: String,
    expires_at: u64,
}

pub enum CodeUse {
    Valid(Box<CodeGrant>),
    /// Ya se había canjeado: quien lo repite puede haberlo robado (se revoca lo que dio).
    Reused(Option<String>),
    Unknown,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AccessUse {
    Valid { kid: String, resource: String },
    Expired,
    Unknown,
}

#[derive(Default)]
pub struct Store {
    requests: HashMap<String, AuthRequest>,
    codes: HashMap<String, StoredCode>,
    used: HashMap<String, Used>,
    access: HashMap<String, Vec<AccessEntry>>,
}

fn full() -> AppError {
    AppError::Invalid("Demasiadas autorizaciones a la vez: espera un minuto.".into())
}

impl Store {
    fn prune(&mut self, now: u64) {
        self.requests.retain(|_, r| r.expires_at > now);
        self.codes.retain(|_, c| c.grant.expires_at > now);
        self.used.retain(|_, u| u.expires_at > now);
        for list in self.access.values_mut() {
            list.retain(|a| a.expires_at > now);
        }
        self.access.retain(|_, l| !l.is_empty());
    }

    /// Guarda una petición validada; devuelve su id (va en la dirección de la página de espera: no da nada
    /// por sí solo, el código solo llega a la dirección de vuelta registrada y sin el verificador no sirve).
    pub fn put_request(&mut self, r: AuthRequest, now: u64) -> AppResult<String> {
        self.prune(now);
        if self.requests.len() >= MAX_REQUESTS {
            return Err(full());
        }
        let id = token::random_hex(16)?.to_string();
        self.requests.insert(id.clone(), r);
        Ok(id)
    }

    /// La saca (un solo uso).
    pub fn take_request(&mut self, id: &str, now: u64) -> Option<AuthRequest> {
        self.prune(now);
        self.requests.remove(id)
    }

    pub fn put_code(&mut self, grant: CodeGrant, now: u64) -> AppResult<Zeroizing<String>> {
        self.prune(now);
        if self.codes.len() >= MAX_CODES {
            return Err(full());
        }
        for _ in 0..ID_TRIES {
            let id = token::new_kid()?;
            if self.codes.contains_key(&id) || self.used.contains_key(&id) {
                continue;
            }
            let issued = token::issue(Kind::Code, &id)?;
            self.codes.insert(id, StoredCode { hash: issued.hash, grant });
            return Ok(issued.token);
        }
        Err(full())
    }

    /// Canjea un código: vale una vez y antes de 60 s.
    pub fn take_code(&mut self, code: &str, now: u64) -> CodeUse {
        self.prune(now);
        let Some(id) = token::kid_of(code, Kind::Code) else { return CodeUse::Unknown };
        if let Some(u) = self.used.get(id) {
            return CodeUse::Reused(u.client.clone());
        }
        match self.codes.get(id) {
            Some(c) if token::verify(code, &c.hash) => {}
            _ => return CodeUse::Unknown,
        }
        let Some(c) = self.codes.remove(id) else { return CodeUse::Unknown };
        self.used.insert(id.to_string(), Used { expires_at: c.grant.expires_at, client: None });
        CodeUse::Valid(Box::new(c.grant))
    }

    /// Anota qué asistente se creó con un código (para revocarlo si alguien lo repite).
    pub fn code_redeemed(&mut self, code: &str, client_id: &str) {
        if let Some(u) = token::kid_of(code, Kind::Code).and_then(|id| self.used.get_mut(id)) {
            u.client = Some(client_id.to_string());
        }
    }

    /// Token de acceso nuevo para el asistente con este `kid`, ligado a `resource`.
    pub fn add_access(&mut self, kid: &str, resource: &str, now: u64) -> AppResult<Zeroizing<String>> {
        self.prune(now);
        let issued = token::issue(Kind::Access, kid)?;
        let list = self.access.entry(kid.to_string()).or_default();
        if list.len() >= ACCESS_PER_CLIENT {
            list.remove(0);
        }
        list.push(AccessEntry { hash: issued.hash, resource: resource.to_string(), expires_at: now + ACCESS_SECS * 1000 });
        Ok(issued.token)
    }

    pub fn check_access(&self, tok: &str, now: u64) -> AccessUse {
        let Some(kid) = token::kid_of(tok, Kind::Access) else { return AccessUse::Unknown };
        match self.access.get(kid).and_then(|l| l.iter().find(|a| token::verify(tok, &a.hash))) {
            Some(a) if a.expires_at > now => AccessUse::Valid { kid: kid.to_string(), resource: a.resource.clone() },
            Some(_) => AccessUse::Expired,
            None => AccessUse::Unknown,
        }
    }

    /// Revoca un token de acceso (los demás del asistente siguen).
    pub fn drop_access(&mut self, tok: &str) {
        if let Some(list) = token::kid_of(tok, Kind::Access).and_then(|kid| self.access.get_mut(kid)) {
            list.retain(|a| !token::verify(tok, &a.hash));
        }
    }
}
