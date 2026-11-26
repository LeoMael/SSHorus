//! Servidores, proyectos y el resultado de exportar a `~/.ssh/config`.

use serde::{Deserialize, Serialize};

// ───────────────────────── Servidores y proyectos ─────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    Key,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfile {
    /// Vacío al crear; el motor asigna un UUID.
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// Ruta a la llave privada (si auth = key). Acepta `~/`.
    pub key_path: Option<String>,
    /// Carpeta a abrir al conectar (si no, el home del usuario).
    pub default_path: Option<String>,
    /// Color de acento (hex) para reconocerlo en pestañas.
    pub color: Option<String>,
    /// Terminales persistentes (tmux) de este servidor. None = usar el ajuste general.
    #[serde(default)]
    pub tmux: Option<TmuxMode>,
    /// De dónde sale la contraseña de sudo (la guardada va en la bóveda o el llavero, nunca aquí).
    #[serde(default)]
    pub sudo_mode: SudoMode,
}

/// De dónde sale la contraseña de sudo de un servidor.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SudoMode {
    /// Pedirla cada vez (solo vive en memoria durante la conexión).
    #[default]
    Ask,
    /// Usar la contraseña de conexión guardada (solo si se entra con contraseña).
    Login,
    /// Usar la guardada aparte (id "<id>:sudo"); útil al entrar con llave SSH.
    Saved,
}

/// Cuándo abrir las terminales dentro de tmux (sobreviven a cortes de red y al cierre de la app).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TmuxMode {
    /// Usar tmux si el servidor lo tiene; si no, terminal normal sin avisos.
    #[default]
    Auto,
    /// Usar tmux siempre; si no está instalado se abre una terminal normal y se avisa.
    Always,
    /// Nunca usar tmux.
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub server_id: String,
    pub path: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// Vacío al crear; el motor asigna un UUID.
    pub id: String,
    pub name: String,
    pub server_ids: Vec<String>,
    pub bookmarks: Vec<Bookmark>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesData {
    pub servers: Vec<ServerProfile>,
    pub projects: Vec<Project>,
}

// ───────────────────────── ~/.ssh/config ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigExport {
    pub path: String,
    /// Servidores escritos en el bloque de SSHorus.
    pub count: usize,
}
