//! Datos del emparejado que ve la interfaz: quién pide conectarse, tu respuesta y la lista de asistentes.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::super::approval::Pendable;
use super::super::policy::Access;
use super::token::TokenHash;

/// Cómo se conectó un asistente.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    /// `sshorus-mcp pair` (puente stdio): un token propio en el llavero.
    #[default]
    Bridge,
    /// HTTP directo con la autorización estándar de MCP (OAuth): tokens de acceso que caducan y se renuevan.
    #[serde(rename = "oauth")]
    OAuth,
}

/// Un dato que se muestra en el diálogo («Programa», «Navegador»…): lo dice el propio equipo, sin comprobar
/// salvo que el texto diga lo contrario.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

impl Fact {
    pub fn new(label: &str, value: impl Into<String>) -> Self {
        let value = value.into();
        Fact { label: label.into(), value: if value.trim().is_empty() { "—".into() } else { value } }
    }
}

/// Con qué cliente OAuth y para qué recurso se emitieron los tokens de un asistente conectado por HTTP.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLink {
    /// `client_id` de OAuth (la URL de su documento de metadatos o el id que le dio el registro dinámico).
    pub client_id: String,
    /// Recurso al que van ligados sus tokens (`http://127.0.0.1:<puerto>/mcp`).
    pub resource: String,
}

/// Un asistente emparejado, tal como se guarda en `mcp-clients.json` (sin tokens: solo una huella).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedClient {
    /// «claude», «codex», «claude-code-http»…: uno por asistente (volver a emparejar reemplaza al anterior).
    pub id: String,
    pub name: String,
    /// Lo que vio el puente al emparejar, o el `client_id` de OAuth (información, no comprobada).
    pub program: String,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub created_at: u64,
    pub last_used: Option<u64>,
    /// Servidor → nivel. Lo que no está = Sin acceso.
    pub access: BTreeMap<String, Access>,
    /// Parte pública de sus tokens (ver `token.rs`).
    pub kid: String,
    /// Huella del token del puente o, por OAuth, del token de renovación vigente.
    pub token: TokenHash,
    #[serde(default)]
    pub via: Via,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth: Option<OAuthLink>,
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
    pub via: Via,
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
            via: c.via,
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
    pub via: Via,
    /// Lo que se sabe de quién lo pide (programa, carpeta, navegador…).
    pub facts: Vec<Fact>,
    /// Ya estaba emparejado: aceptar reemplaza su conexión (la vieja deja de valer).
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
