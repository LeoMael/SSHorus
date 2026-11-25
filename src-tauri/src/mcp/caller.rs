//! Quién hace cada llamada y con qué permisos.
//!
//! - Con el token general (la configuración copiada a mano): valen los permisos por servidor de Ajustes
//!   (`McpConfig::access`), como siempre.
//! - Con el token de un asistente emparejado (por el puente o por OAuth): valen SUS permisos por servidor, los que elegiste al aceptarlo
//!   (o después con «Cambiar permisos»). Son los únicos que cuentan para él: así cada asistente tiene lo
//!   suyo y se ve de un vistazo. El resto de reglas son por servidor y valen para todos: «Solo lo marcado»,
//!   usuarios protegidos, «Permitir siempre» y «Aceptar automáticamente».
//!
//! `http.rs` deja el `Caller` en la petición y `server.rs` se lo pasa a `McpCore`.

use std::collections::BTreeMap;

use super::config::McpConfig;
use super::policy::Access;

/// Un asistente emparejado, tal como se identificó en esta petición.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientGrant {
    pub id: String,
    pub name: String,
    /// Servidor → nivel (lo que no está = Sin acceso).
    pub access: BTreeMap<String, Access>,
}

/// Permisos de los asistentes emparejados, para lo que se configura por servidor y vale para todos
/// (como «Aceptar automáticamente», que se ofrece si alguien tiene acceso Completo o Solo lo marcado).
pub trait PairedAccess: Send + Sync {
    fn allows_auto(&self, server_id: &str) -> bool;
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Caller {
    /// None = token general.
    pub client: Option<ClientGrant>,
}

impl Caller {
    pub fn paired(grant: ClientGrant) -> Self {
        Caller { client: Some(grant) }
    }

    /// Nivel de acceso a un servidor para quien llama.
    pub fn access_of(&self, cfg: &McpConfig, server_id: &str) -> Access {
        match &self.client {
            Some(c) => c.access.get(server_id).copied().unwrap_or_default(),
            None => cfg.access_of(server_id),
        }
    }
}
