//! Ajustes de la app (`settings.json`).

use serde::{Deserialize, Serialize};

use super::TmuxMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Apariencia: "dark" | "light" | "system" | "midnight" | "sand" | "fjord" | "contrast" (lista en src/styles/themes.ts).
    pub theme: String,
    /// Color de acento elegido ("" = el de la apariencia).
    pub accent: String,
    /// Tamaño de letra de la interfaz en px (12..=16).
    pub ui_font_size: u16,
    pub terminal_font_size: u16,
    pub terminal_font_family: String,
    /// Transferencias simultáneas (1..=8).
    pub transfer_concurrency: u8,
    pub show_hidden_files: bool,
    pub confirm_delete: bool,
    /// Tamaño máximo para abrir en el editor.
    pub editor_max_bytes: u64,
    /// Tamaños de paneles guardados por la interfaz (porcentajes), clave libre.
    pub layout: std::collections::HashMap<String, Vec<f64>>,
    /// Intervalo de la señal de vida SSH (s). Se da por caída tras 3 sin respuesta (5..=120).
    pub keepalive_secs: u16,
    /// Reintentar solo cuando se cae la conexión.
    pub auto_reconnect: bool,
    /// Intentos de reconexión automática (1..=20).
    pub reconnect_attempts: u8,
    pub editor_font_size: u16,
    pub editor_font_family: String,
    /// Mantener ~/.ssh/config sincronizado con los servidores guardados.
    pub ssh_config_sync: bool,
    /// Si el destino ya existe al transferir: "overwrite" | "skip" | "newer" (solo si el origen es más nuevo) | "ask" (preguntar).
    pub transfer_conflict: String,
    /// Terminales persistentes (tmux) por defecto. Cada servidor puede cambiarlo.
    pub terminal_tmux: TmuxMode,
    /// Bloquear SSHorus tras estos minutos sin uso (0 = nunca). Solo con bóveda: 5/10/15/30/60.
    pub lock_minutes: u32,
    /// El usuario dijo «Ahora no» a crear el PIN: no se vuelve a preguntar al iniciar.
    pub vault_prompt_dismissed: bool,
    /// Escáner de vulnerabilidades (fuentes, límite de imágenes, usuarios elegidos por servidor).
    pub vulnscan: crate::vulnscan::VulnScanSettings,
    /// Asistente de IA opcional (URL base y modelo; el token va en la bóveda o el llavero).
    pub ai: crate::ai::AiSettings,
    /// Terminal local y asistentes (Claude Code, Codex): qué contexto se les da y cómo.
    pub local_ai: crate::localterm::LocalAiSettings,
    /// Atajos de teclado cambiados por el usuario: id de acción → combinación ("" = sin atajo).
    /// Solo los distintos de los de por defecto; la lista y la validación están en la interfaz.
    pub shortcuts: std::collections::HashMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent: String::new(),
            ui_font_size: 13,
            terminal_font_size: 14,
            terminal_font_family: "'JetBrains Mono', 'Fira Code', 'Noto Sans Mono', monospace".into(),
            transfer_concurrency: 4,
            show_hidden_files: false,
            confirm_delete: true,
            editor_max_bytes: 5 * 1024 * 1024,
            layout: Default::default(),
            keepalive_secs: 10,
            auto_reconnect: true,
            reconnect_attempts: 5,
            editor_font_size: 14,
            editor_font_family: "'JetBrains Mono', 'Fira Code', 'Noto Sans Mono', monospace".into(),
            ssh_config_sync: false,
            transfer_conflict: "ask".into(),
            terminal_tmux: TmuxMode::Auto,
            lock_minutes: 15,
            vault_prompt_dismissed: false,
            vulnscan: Default::default(),
            ai: Default::default(),
            local_ai: Default::default(),
            shortcuts: Default::default(),
        }
    }
}
