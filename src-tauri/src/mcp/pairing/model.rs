//! Datos del emparejado que ve la interfaz: la petición del diálogo, tu respuesta y la lista de asistentes.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::super::approval::Pendable;
use super::super::policy::Access;
use super::token::TokenHash;

/// Un asistente emparejado, tal como se guarda en `mcp-clients.json` (sin el token: solo su huella).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedClient {
    /// «claude», «codex»…: uno por asistente (volver a emparejar reemplaza al anterior).
    pub id: String,
    pub name: String,
    /// Lo que vio el puente al emparejar (información del equipo, no comprobada).
    pub program: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub created_at: u64,
    pub last_used: Option<u64>,
    /// Servidor → nivel. Lo que no está = Sin acceso.
    pub access: BTreeMap<String, Access>,
    /// Parte pública del token (ver `token.rs`).
    pub kid: String,
    pub token: TokenHash,
}

/// Lo mismo sin la huella del token (para la interfaz).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientView {
    pub id: String,
    pub name: String,
    pub program: String,
    pub cwd: Option<String>,
    pub created_at: u64,
    pub last_used: Option<u64>,
    pub access: BTreeMap<String, Access>,
}

impl From<&PairedClient> for ClientView {
    fn from(c: &PairedClient) -> Self {
        ClientView {
            id: c.id.clone(),
            name: c.name.clone(),
            program: c.program.clone(),
            cwd: c.cwd.clone(),
            created_at: c.created_at,
            last_used: c.last_used,
            access: c.access.clone(),
        }
    }
}

/// Lo que muestra el diálogo «Conectar un asistente».
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairPrompt {
    pub id: String,
    pub client_id: String,
    pub name: String,
    pub program: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    /// Ya estaba emparejado: aceptar reemplaza su token (el viejo deja de valer).
    pub replaces: bool,
    /// Permisos que ya tenía (si se reemplaza), para empezar desde ahí.
    pub current: BTreeMap<String, Access>,
    pub timeout_secs: u64,
    /// Unix ms en que se rechaza solo.
    pub expires_at: u64,
}

impl Pendable for PairPrompt {
    fn id(&self) -> &str {
        &self.id
    }
    fn expires_at(&self) -> u64 {
        self.expires_at
    }
}

/// Tu respuesta en el diálogo.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairDecision {
    pub accept: bool,
    #[serde(default)]
    pub access: BTreeMap<String, Access>,
}

impl PairDecision {
    pub fn reject() -> Self {
        PairDecision { accept: false, access: BTreeMap::new() }
    }
}

/// Solo los niveles que dan algo (lo demás es Sin acceso).
pub fn clean_access(access: BTreeMap<String, Access>) -> BTreeMap<String, Access> {
    access.into_iter().filter(|(k, v)| !k.trim().is_empty() && *v != Access::None).collect()
}
