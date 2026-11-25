//! Asistentes emparejados: `<config>/sshorus/mcp-clients.json` (sin secretos: solo la huella de cada
//! token) y la comprobación de los tokens. Una sola lista para los dos caminos (puente y OAuth).

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::super::policy::Access;
use super::model::{clean_access, PairedClient, Via};
use super::token::{self, Kind, TokenHash};
use crate::error::{AppError, AppResult};
use crate::storage::fsutil;

pub const FILE_NAME: &str = "mcp-clients.json";
/// «Último uso» se guarda en disco como mucho una vez por minuto (cada petición lo toca).
const TOUCH_SAVE_MS: u64 = 60_000;
/// Fichas de revocados que se recuerdan (para decir «revocado» en vez de «token incorrecto»).
const KEEP_REVOKED: usize = 50;
/// Un mismo token revocado se anota en el registro como mucho una vez por minuto.
const FAIL_LOG_MS: u64 = 60_000;
/// Intentos de sacar un `kid` que no esté en uso (con 32 bits, repetir es rarísimo).
const KID_TRIES: usize = 16;

/// Un asistente que ya no está emparejado.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revoked {
    pub kid: String,
    pub id: String,
    pub name: String,
    pub at: u64,
    #[serde(default)]
    pub via: Via,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
struct ClientsFile {
    clients: Vec<PairedClient>,
    revoked: Vec<Revoked>,
}

/// Resultado de comprobar un token de asistente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenCheck {
    Valid(PairedClient),
    /// Era de un asistente que revocaste (o que se volvió a emparejar con otro token).
    Revoked(Revoked),
    Unknown,
}

pub struct ClientRegistry {
    path: Option<PathBuf>,
    data: Mutex<ClientsFile>,
    /// kid → último aviso de token revocado anotado (ms).
    fail_logged: Mutex<HashMap<String, u64>>,
}

fn guard<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// El tipo de token que guarda la ficha de cada camino (el de acceso de OAuth vive solo en memoria).
fn stored_kind(via: Via) -> Kind {
    match via {
        Via::Bridge => Kind::Bridge,
        Via::OAuth => Kind::Refresh,
    }
}

impl ClientRegistry {
    pub fn load() -> Self {
        Self::at(fsutil::config_dir().map(|d| d.join(FILE_NAME)))
    }

    /// En una ruta concreta (None = solo memoria).
    pub fn at(path: Option<PathBuf>) -> Self {
        let data = path.as_deref().map(fsutil::read_json_or_default).unwrap_or_default();
        ClientRegistry { path, data: Mutex::new(data), fail_logged: Mutex::new(HashMap::new()) }
    }

    pub fn list(&self) -> Vec<PairedClient> {
        guard(&self.data).clients.clone()
    }

    pub fn get(&self, id: &str) -> Option<PairedClient> {
        guard(&self.data).clients.iter().find(|c| c.id == id).cloned()
    }

    /// Cambia la lista con `f` y la guarda. Si el disco falla, nada cambia.
    fn update<T>(&self, f: impl FnOnce(&mut ClientsFile) -> T) -> AppResult<T> {
        let mut g = guard(&self.data);
        let mut next = g.clone();
        let out = f(&mut next);
        next.revoked.truncate(KEEP_REVOKED);
        if next != *g {
            if let Some(p) = &self.path {
                fsutil::write_json_atomic(p, &next)?;
            }
            *g = next;
        }
        Ok(out)
    }

    /// Guarda un asistente nuevo con un `kid` que no usa nadie (ni un revocado). `make` crea su ficha y su
    /// token con ese `kid`. Si ya había uno con ese id, lo reemplaza y sus tokens viejos quedan revocados.
    pub fn insert_new<T>(&self, now: u64, make: impl FnOnce(&str) -> AppResult<(PairedClient, T)>) -> AppResult<(PairedClient, T)> {
        self.update(|d| {
            let kid = fresh_kid(d)?;
            let (client, extra) = make(&kid)?;
            if let Some(old) = take(&mut d.clients, &client.id) {
                d.revoked.insert(0, revoked_from(&old, now));
            }
            d.clients.push(client.clone());
            Ok((client, extra))
        })?
    }

    pub fn set_access(&self, id: &str, access: BTreeMap<String, Access>) -> AppResult<PairedClient> {
        let access = clean_access(access);
        self.update(|d| {
            let c = d.clients.iter_mut().find(|c| c.id == id)?;
            c.access = access;
            Some(c.clone())
        })?
        .ok_or_else(|| not_found(id))
    }

    /// Quita un asistente: sus tokens dejan de valer en el acto.
    pub fn revoke(&self, id: &str, now: u64) -> AppResult<PairedClient> {
        self.update(|d| {
            let old = take(&mut d.clients, id)?;
            d.revoked.insert(0, revoked_from(&old, now));
            Some(old)
        })?
        .ok_or_else(|| not_found(id))
    }

    fn lookup(&self, kid: &str) -> (Option<PairedClient>, Option<Revoked>) {
        let d = guard(&self.data);
        (d.clients.iter().find(|c| c.kid == kid).cloned(), d.revoked.iter().find(|r| r.kid == kid).cloned())
    }

    /// Comprueba el token guardado de un asistente (el del puente o el de renovación) y anota el uso.
    pub fn check(&self, tok: &str, kind: Kind, now: u64) -> TokenCheck {
        let Some(kid) = token::kid_of(tok, kind) else { return TokenCheck::Unknown };
        match self.lookup(kid) {
            (Some(c), _) if stored_kind(c.via) == kind && token::verify(tok, &c.token) => {
                self.touch(&c, now);
                TokenCheck::Valid(c)
            }
            (None, Some(r)) => TokenCheck::Revoked(r),
            _ => TokenCheck::Unknown,
        }
    }

    /// Asistente dueño de un `kid` (su token ya se comprobó aparte: el de acceso de OAuth) y anota el uso.
    pub fn active(&self, kid: &str, now: u64) -> TokenCheck {
        match self.lookup(kid) {
            (Some(c), _) => {
                self.touch(&c, now);
                TokenCheck::Valid(c)
            }
            (None, Some(r)) => TokenCheck::Revoked(r),
            _ => TokenCheck::Unknown,
        }
    }

    /// Cambia el token de renovación de un asistente OAuth por `next`, solo si `tok` es el vigente y `accept`
    /// da el visto bueno a su ficha (así cada token de renovación vale una sola vez, aunque lleguen dos a la vez).
    pub fn rotate(
        &self,
        tok: &str,
        next: TokenHash,
        now: u64,
        accept: impl FnOnce(&PairedClient) -> bool,
    ) -> AppResult<TokenCheck> {
        let Some(kid) = token::kid_of(tok, Kind::Refresh) else { return Ok(TokenCheck::Unknown) };
        self.update(|d| {
            if let Some(r) = d.revoked.iter().find(|r| r.kid == kid) {
                return TokenCheck::Revoked(r.clone());
            }
            match d.clients.iter_mut().find(|c| c.kid == kid && c.via == Via::OAuth) {
                Some(c) if token::verify(tok, &c.token) && accept(c) => {
                    c.token = next;
                    c.last_used = Some(now);
                    TokenCheck::Valid(c.clone())
                }
                _ => TokenCheck::Unknown,
            }
        })
    }

    fn touch(&self, c: &PairedClient, now: u64) {
        if c.last_used.is_some_and(|t| now.saturating_sub(t) < TOUCH_SAVE_MS) {
            return;
        }
        let id = c.id.clone();
        if let Err(e) = self.update(|d| {
            if let Some(x) = d.clients.iter_mut().find(|x| x.id == id) {
                x.last_used = Some(now);
            }
        }) {
            log::warn!("MCP: no se pudo guardar el último uso de {id}: {e}");
        }
    }

    /// ¿Se anota este intento con un token revocado? (como mucho uno por minuto y token).
    pub fn should_log_failure(&self, kid: &str, now: u64) -> bool {
        let mut m = guard(&self.fail_logged);
        let due = m.get(kid).is_none_or(|t| now.saturating_sub(*t) >= FAIL_LOG_MS);
        if due {
            m.insert(kid.to_string(), now);
        }
        due
    }
}

fn fresh_kid(d: &ClientsFile) -> AppResult<String> {
    pick_kid(|k| d.clients.iter().any(|c| c.kid == k) || d.revoked.iter().any(|r| r.kid == k), token::new_kid)
}

/// Un `kid` que no esté en `used` (si sale uno repetido, pide otro a `next`).
pub(super) fn pick_kid(used: impl Fn(&str) -> bool, mut next: impl FnMut() -> AppResult<String>) -> AppResult<String> {
    for _ in 0..KID_TRIES {
        let kid = next()?;
        if !used(&kid) {
            return Ok(kid);
        }
    }
    Err(AppError::Invalid("no se pudo crear un identificador de token libre".into()))
}

fn take(list: &mut Vec<PairedClient>, id: &str) -> Option<PairedClient> {
    let i = list.iter().position(|c| c.id == id)?;
    Some(list.remove(i))
}

fn revoked_from(c: &PairedClient, now: u64) -> Revoked {
    Revoked { kid: c.kid.clone(), id: c.id.clone(), name: c.name.clone(), at: now, via: c.via }
}

fn not_found(id: &str) -> AppError {
    AppError::NotFound(format!("el asistente «{id}» ya no está emparejado"))
}
