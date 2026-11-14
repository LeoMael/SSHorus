//! Los asistentes de IA de línea de comandos que SSHorus sabe abrir, descritos como **datos**:
//! programa, cómo se instala, cómo recibe el contexto y cómo se le configura el MCP.
//! El resto del código recorre esta tabla (`TOOLS`) en vez de preguntar por cada asistente.
//!
//! Para añadir otro asistente: una variante en `AiTool` y una entrada en `TOOLS`
//! (y su fila en `ASSISTANTS` de `src/features/localterm/logic.ts`).

use serde::{Deserialize, Serialize};

use super::aicli::Os;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTool {
    Claude,
    Codex,
    Agy,
    OpenCode,
}

impl AiTool {
    pub fn spec(self) -> &'static ToolSpec {
        // Cada variante tiene su entrada (lo comprueba la prueba `tabla_completa`).
        TOOLS.iter().find(|s| s.tool == self).unwrap_or(&TOOLS[0])
    }
}

/// Qué lanzar en Windows cuando npm solo dejó un `.cmd` (ruta dentro de `node_modules`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NpmShim {
    /// Un `.js`: se lanza con node.
    Js(&'static [&'static str]),
    /// Un ejecutable: se lanza directamente.
    Exe(&'static [&'static str]),
}

/// Comando oficial de instalación.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallCmd {
    pub command: &'static str,
    /// Hace falta Node.js (npm).
    pub needs_node: bool,
}

/// Cómo recibe el contexto de SSHorus (nunca escribiendo en la carpeta del usuario).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextVia {
    /// Una opción que añade el texto a las instrucciones del sistema (`--append-system-prompt`).
    SystemPromptFlag(&'static str),
    /// `-c developer_instructions="…"` (configuración TOML de Codex).
    CodexInstructions,
    /// Un archivo de SSHorus (fuera de la carpeta del usuario) en `instructions` de la
    /// configuración que va por variable de entorno (OpenCode).
    InstructionsFile,
    /// Como primer mensaje de la conversación (`-i "<texto>"`): no admite instrucciones del sistema.
    FirstMessage(&'static str),
}

/// Cómo se le configura el MCP de SSHorus (sin poner el token en archivos ni argumentos).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpVia {
    /// `--mcp-config '<json>'`.
    ClaudeConfigFlag,
    /// `-c mcp_servers.sshorus.*` con `env_vars` para pasarle el token.
    CodexConfig,
    /// `mcp` en la configuración que va por variable de entorno (el puente hereda el token).
    ConfigEnv,
    /// Solo lo lee de sus archivos de configuración: SSHorus no los toca.
    Unsupported,
}

/// Configuración en JSON pasada por variable de entorno (sin archivos en la carpeta del usuario).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigEnv {
    pub var: &'static str,
    /// Opción para que use un servidor propio que lea esa variable (y no uno compartido ya en marcha)…
    pub private_server_flag: &'static str,
    /// …que existe desde esta versión mayor.
    pub flag_since_major: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolSpec {
    pub tool: AiTool,
    pub label: &'static str,
    /// Nombre del programa (sin `.exe`).
    pub program: &'static str,
    pub npm_shim: Option<NpmShim>,
    pub install_unix: InstallCmd,
    pub install_windows: InstallCmd,
    /// Carpetas donde lo deja su instalador, relativas a la carpeta personal (Linux y macOS)…
    pub home_dirs: &'static [&'static str],
    /// …y a `%LOCALAPPDATA%` (Windows).
    pub local_appdata_dirs: &'static [&'static str],
    pub context: ContextVia,
    pub mcp: McpVia,
    pub config_env: Option<ConfigEnv>,
}

impl ToolSpec {
    pub fn install(&self, os: Os) -> InstallCmd {
        if os == Os::Windows { self.install_windows } else { self.install_unix }
    }

    pub fn supports_mcp(&self) -> bool {
        self.mcp != McpVia::Unsupported
    }
}

pub const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        tool: AiTool::Claude,
        label: "Claude Code",
        program: "claude",
        npm_shim: Some(NpmShim::Js(&["@anthropic-ai", "claude-code", "cli.js"])),
        install_unix: InstallCmd { command: "curl -fsSL https://claude.ai/install.sh | bash", needs_node: false },
        install_windows: InstallCmd { command: "irm https://claude.ai/install.ps1 | iex", needs_node: false },
        home_dirs: &[],
        local_appdata_dirs: &[],
        context: ContextVia::SystemPromptFlag("--append-system-prompt"),
        mcp: McpVia::ClaudeConfigFlag,
        config_env: None,
    },
    ToolSpec {
        tool: AiTool::Codex,
        label: "Codex",
        program: "codex",
        npm_shim: Some(NpmShim::Js(&["@openai", "codex", "bin", "codex.js"])),
        install_unix: InstallCmd { command: "npm install -g @openai/codex", needs_node: true },
        // npm.cmd: en PowerShell, `npm` (npm.ps1) puede estar bloqueado por la política de scripts.
        install_windows: InstallCmd { command: "npm.cmd install -g @openai/codex", needs_node: true },
        home_dirs: &[],
        local_appdata_dirs: &[],
        context: ContextVia::CodexInstructions,
        mcp: McpVia::CodexConfig,
        config_env: None,
    },
    ToolSpec {
        tool: AiTool::Agy,
        label: "Antigravity (agy)",
        program: "agy",
        npm_shim: None,
        install_unix: InstallCmd { command: "curl -fsSL https://antigravity.google/cli/install.sh | bash", needs_node: false },
        install_windows: InstallCmd { command: "irm https://antigravity.google/cli/install.ps1 | iex", needs_node: false },
        home_dirs: &[],
        local_appdata_dirs: &["agy/bin"],
        context: ContextVia::FirstMessage("-i"),
        mcp: McpVia::Unsupported,
        config_env: None,
    },
    ToolSpec {
        tool: AiTool::OpenCode,
        label: "OpenCode",
        program: "opencode",
        npm_shim: Some(NpmShim::Exe(&["@opencode", "cli", "bin", "opencode.exe"])),
        install_unix: InstallCmd { command: "curl -fsSL https://opencode.ai/v2/install | bash", needs_node: false },
        // No hay instalador para Windows: el paquete de npm trae el ejecutable.
        install_windows: InstallCmd { command: "npm.cmd install -g @opencode/cli", needs_node: true },
        home_dirs: &[".opencode/bin"],
        local_appdata_dirs: &[],
        context: ContextVia::InstructionsFile,
        mcp: McpVia::ConfigEnv,
        config_env: Some(ConfigEnv {
            var: "OPENCODE_CONFIG_CONTENT",
            private_server_flag: "--standalone",
            flag_since_major: 2,
        }),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabla_completa() {
        for t in [AiTool::Claude, AiTool::Codex, AiTool::Agy, AiTool::OpenCode] {
            assert_eq!(t.spec().tool, t);
        }
        let mut names: Vec<_> = TOOLS.iter().map(|s| s.program).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), TOOLS.len(), "programas repetidos");
    }

    #[test]
    fn comandos_de_instalacion() {
        let cmd = |t: AiTool, os| t.spec().install(os).command;
        assert_eq!(cmd(AiTool::Claude, Os::Linux), "curl -fsSL https://claude.ai/install.sh | bash");
        assert_eq!(cmd(AiTool::Claude, Os::Mac), "curl -fsSL https://claude.ai/install.sh | bash");
        assert_eq!(cmd(AiTool::Claude, Os::Windows), "irm https://claude.ai/install.ps1 | iex");
        assert_eq!(cmd(AiTool::Codex, Os::Linux), "npm install -g @openai/codex");
        assert_eq!(cmd(AiTool::Codex, Os::Windows), "npm.cmd install -g @openai/codex");
        assert_eq!(cmd(AiTool::Agy, Os::Mac), "curl -fsSL https://antigravity.google/cli/install.sh | bash");
        assert_eq!(cmd(AiTool::Agy, Os::Windows), "irm https://antigravity.google/cli/install.ps1 | iex");
        assert_eq!(cmd(AiTool::OpenCode, Os::Linux), "curl -fsSL https://opencode.ai/v2/install | bash");
        assert_eq!(cmd(AiTool::OpenCode, Os::Windows), "npm.cmd install -g @opencode/cli");
        assert!(AiTool::Codex.spec().install(Os::Linux).needs_node);
        assert!(!AiTool::Claude.spec().install(Os::Linux).needs_node);
        assert!(!AiTool::OpenCode.spec().install(Os::Mac).needs_node);
        assert!(AiTool::OpenCode.spec().install(Os::Windows).needs_node);
    }

    #[test]
    fn quien_admite_mcp() {
        assert!(AiTool::Claude.spec().supports_mcp());
        assert!(AiTool::Codex.spec().supports_mcp());
        assert!(AiTool::OpenCode.spec().supports_mcp());
        assert!(!AiTool::Agy.spec().supports_mcp());
    }

    #[test]
    fn nombres_en_json() {
        assert_eq!(serde_json::to_string(&AiTool::OpenCode).unwrap(), "\"opencode\"");
        assert_eq!(serde_json::from_str::<AiTool>("\"agy\"").unwrap(), AiTool::Agy);
    }
}
