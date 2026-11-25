//! Emparejar por OAuth (la autorización estándar de MCP) a los asistentes que se conectan por HTTP directo,
//! sin puente ni token copiado: `claude mcp add --transport http sshorus http://127.0.0.1:<puerto>/mcp`.
//!
//! SSHorus hace de servidor de recursos y de servidor de autorización, en el mismo `127.0.0.1`:
//! 1. `/mcp` sin token → 401 con `WWW-Authenticate: Bearer resource_metadata=…` (`metadata`).
//! 2. El cliente lee los metadatos, se identifica (documento de metadatos o registro dinámico,
//!    `clients`/`directory`) y abre el navegador en `/authorize` con PKCE S256 (`pkce`) y `resource`.
//! 3. La página dice «Vuelve a SSHorus para aceptar» (`page`) y SSHorus muestra el MISMO diálogo que el
//!    puente (`pairing::consent`): mismos permisos por asistente, límite de peticiones y registro.
//! 4. Si aceptas, el navegador vuelve a la dirección registrada del cliente (`redirect`) con un código de
//!    un solo uso (60 s); el cliente lo canjea en `/token` (`grant`) por un token de acceso (1 h) y uno de
//!    renovación (que cambia en cada uso). Si rechazas, vuelve con `error=access_denied`.
//!
//! Los tokens van a la misma lista de asistentes que los del puente: «Cambiar permisos» y «Revocar» valen
//! igual (revocar mata los de acceso y el de renovación). Solo se guardan huellas. Las piezas puras
//! (`metadata`, `redirect`, `pkce`, `clients`, `form`, `store`) no saben de HTTP; `route` es la única que sí.

pub mod authorize;
pub mod clients;
pub mod directory;
pub mod form;
pub mod grant;
pub mod metadata;
pub mod page;
pub mod pkce;
pub mod redirect;
pub mod route;
pub mod store;
#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex, MutexGuard};

use super::audit::{now_ms, AuditLog};
use super::pairing::limiter::RateLimiter;
use super::pairing::{Auth, Pairing};
use clients::RegistrationError;
use directory::Directory;
use metadata::Here;
use store::{AccessUse, Store};

/// Registros dinámicos por minuto (no muestran nada; es solo para que nadie llene la lista).
const REGISTER_PER_MINUTE: usize = 10;

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub struct OAuth {
    pairing: Arc<Pairing>,
    directory: Directory,
    store: Mutex<Store>,
    register_limit: Mutex<RateLimiter>,
}

impl OAuth {
    pub fn new(pairing: Arc<Pairing>, directory: Directory) -> Self {
        OAuth {
            pairing,
            directory,
            store: Mutex::new(Store::default()),
            register_limit: Mutex::new(RateLimiter::with_max(REGISTER_PER_MINUTE)),
        }
    }

    /// En la app: descarga los documentos de metadatos por HTTPS y guarda los registros en disco.
    pub fn load(pairing: Arc<Pairing>) -> Self {
        Self::new(pairing, Directory::new(Box::new(directory::HttpsFetcher), Directory::default_path()))
    }

    /// Dueño de un token de acceso (`tvo_…`) para el recurso `here`. Calcula huellas y puede escribir en
    /// disco (último uso): fuera del hilo async.
    pub fn authenticate(&self, tok: &str, here: &Here, audit: &AuditLog) -> Auth {
        let now = now_ms();
        let check = lock(&self.store).check_access(tok, now);
        match check {
            AccessUse::Valid { kid, resource } if metadata::same_resource(&resource, &here.resource()) => {
                self.pairing.auth_of(self.pairing.registry().active(&kid, now), audit, now)
            }
            AccessUse::Expired => Auth::Expired,
            AccessUse::Valid { .. } | AccessUse::Unknown => Auth::Unknown,
        }
    }

    /// `POST /register` (RFC 7591). Escribe en disco: fuera del hilo async.
    pub fn register(&self, body: &[u8]) -> Result<serde_json::Value, RegistrationError> {
        let now = now_ms();
        let slot = uuid::Uuid::new_v4().to_string();
        let mut limit = lock(&self.register_limit);
        if limit.begin(&slot, now).is_err() {
            return Err(RegistrationError { code: "invalid_client_metadata", description: "Demasiados registros: espera un minuto.".into() });
        }
        limit.finish(&slot);
        drop(limit);
        let req = serde_json::from_slice(body)
            .map_err(|_| RegistrationError { code: "invalid_client_metadata", description: "El registro no es JSON válido.".into() })?;
        let info = self.directory.register(req)?;
        log::info!("MCP: cliente OAuth registrado: {} ({})", info.name, info.client_id);
        Ok(clients::registration_response(&info, now / 1000))
    }
}
