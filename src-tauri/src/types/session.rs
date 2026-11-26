//! Sesiones SSH y terminales.

use serde::{Deserialize, Serialize};

// ───────────────────────── SSH ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyInfo {
    pub host: String,
    pub port: u16,
    /// p. ej. "ssh-ed25519"
    pub algorithm: String,
    /// p. ej. "SHA256:abc..."
    pub fingerprint: String,
    /// Llave pública en formato OpenSSH; se devuelve tal cual en `ssh_trust_host`.
    pub key_openssh: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// Unix ms
    pub connected_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReconnecting {
    pub session_id: String,
    /// Intento actual (1-based).
    pub attempt: u8,
    pub max_attempts: u8,
    /// Segundos hasta el próximo intento.
    pub next_retry_secs: u32,
    pub reason: String,
    /// Espera a que se desbloquee SSHorus para usar la contraseña guardada (no gasta intentos).
    #[serde(default)]
    pub waiting_unlock: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionClosed {
    pub session_id: String,
    pub reason: String,
}

// ───────────────────────── Terminal ─────────────────────────

/// Petición de abrir la terminal dentro de una sesión tmux (parámetro de `term_open`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxOpen {
    /// Nombre estable de la sesión tmux (`sshorus-…`). Si ya existe, se engancha a ella.
    pub name: String,
    /// Antes de engancharse, volcar el historial de la sesión (terminal recién creada en la interfaz).
    #[serde(default)]
    pub replay: bool,
    /// Comprobar si la sesión ya existía antes de engancharse (para informar bien al reconectar).
    #[serde(default)]
    pub check_existing: bool,
}

/// Resultado de `term_open`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermOpened {
    pub term_id: String,
    /// Nombre de la sesión tmux si la terminal es persistente; None = shell normal.
    pub tmux: Option<String>,
    /// True si `check_existing` estaba activo y la sesión tmux ya existía (se volvió a ella).
    #[serde(default)]
    pub tmux_reattached: bool,
    /// Se pidió tmux pero no está instalado en el servidor.
    pub tmux_missing: bool,
    /// Se pidió tmux y no se pudo usar: motivo en español (no instalado, versión antigua, error).
    pub tmux_problem: Option<String>,
}

/// Una sesión tmux de SSHorus que sigue viva en el servidor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSession {
    pub name: String,
    /// Creación y última actividad (segundos desde epoch).
    pub created: Option<u64>,
    pub activity: Option<u64>,
    /// Clientes enganchados ahora (0 = nadie la está mirando).
    pub attached: u32,
    pub windows: u32,
    /// Programa en primer plano (p. ej. "bash", "vim").
    pub command: String,
    /// Carpeta actual del programa.
    pub path: String,
}

/// Resultado de `term_tmux_list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxList {
    pub installed: bool,
    /// Salida de `tmux -V` (p. ej. "tmux 3.4").
    pub version: Option<String>,
    pub sessions: Vec<TmuxSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub term_id: String,
    pub code: Option<u32>,
}
