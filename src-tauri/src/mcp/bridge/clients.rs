//! Asistentes de IA conocidos: cómo reconocerlos en la cadena de procesos y cómo registrar el puente en
//! su configuración. Una tabla de datos: añadir un asistente es añadir una fila.

use super::caller::{base_name, ProcInfo};
use super::wire;

/// Cómo se registra el puente en la configuración de un asistente.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Setup {
    /// Con su propia línea de comandos. En los argumentos, `{scope}`, `{env}` y `{path}` se sustituyen.
    Cli {
        program: &'static str,
        add: &'static [&'static str],
        /// Para quitar una entrada «sshorus» vieja antes de volver a añadirla.
        remove: &'static [&'static str],
        /// Acepta `--scope user|project`.
        scoped: bool,
    },
    /// A mano: se imprime el bloque para pegar en su archivo.
    Manual(Snippet),
}

/// Formato del bloque para pegar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Snippet {
    /// `{"mcpServers": {"sshorus": {...}}}` (Claude Desktop, Antigravity, Cursor y casi todos).
    McpServers { file: &'static str },
    /// `{"mcp": {"sshorus": {"type": "local", ...}}}` (OpenCode).
    OpenCode { file: &'static str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KnownClient {
    pub id: &'static str,
    pub name: &'static str,
    /// Nombres de programa (sin `.exe`/`.js`) que lo identifican.
    names: &'static [&'static str],
    /// Trozos de ruta que lo identifican cuando corre dentro de node (`…/claude-code/cli.js`).
    path_hints: &'static [&'static str],
    pub setup: Setup,
    /// Qué hacer después para que el asistente vea las herramientas.
    pub reload: &'static str,
}

pub const CLIENTS: &[KnownClient] = &[
    KnownClient {
        id: "claude",
        name: "Claude Code",
        names: &["claude"],
        path_hints: &["claude-code", "@anthropic-ai"],
        setup: Setup::Cli {
            program: "claude",
            add: &["mcp", "add", "-s", "{scope}", "-e", "{env}", "sshorus", "--", "{path}"],
            remove: &["mcp", "remove", "-s", "{scope}", "sshorus"],
            scoped: true,
        },
        reload: "Reconecta con /mcp o abre una conversación nueva.",
    },
    KnownClient {
        id: "codex",
        name: "Codex",
        names: &["codex"],
        path_hints: &["@openai/codex"],
        setup: Setup::Cli {
            program: "codex",
            add: &["mcp", "add", "sshorus", "--env", "{env}", "--", "{path}"],
            remove: &["mcp", "remove", "sshorus"],
            scoped: false,
        },
        reload: "Abre una sesión nueva de Codex.",
    },
    KnownClient {
        id: "gemini",
        name: "Gemini CLI",
        names: &["gemini"],
        path_hints: &["gemini-cli", "@google/gemini"],
        setup: Setup::Cli {
            program: "gemini",
            add: &["mcp", "add", "-s", "{scope}", "-e", "{env}", "sshorus", "{path}"],
            remove: &["mcp", "remove", "-s", "{scope}", "sshorus"],
            scoped: true,
        },
        reload: "Abre una sesión nueva de Gemini CLI (o usa /mcp refresh).",
    },
    KnownClient {
        id: "opencode",
        name: "OpenCode",
        names: &["opencode"],
        path_hints: &["opencode-ai"],
        setup: Setup::Manual(Snippet::OpenCode { file: "~/.config/opencode/opencode.json" }),
        reload: "Reinicia OpenCode.",
    },
    KnownClient {
        id: "agy",
        name: "Antigravity",
        names: &["agy", "antigravity"],
        path_hints: &["antigravity"],
        setup: Setup::Manual(Snippet::McpServers { file: "~/.gemini/antigravity/mcp_config.json" }),
        reload: "Recarga los servidores MCP de Antigravity.",
    },
];

/// Programas intermedios que no son el asistente (shells, envoltorios).
const WRAPPERS: &[&str] = &[
    "sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "nu", "pwsh", "powershell", "cmd", "env", "sudo", "doas",
    "timeout", "nohup", "script", "tmux", "screen", "npx", "npm", "bun", "bunx", "pnpm", "uv", "sshorus-mcp",
];

pub fn by_id(id: &str) -> Option<&'static KnownClient> {
    CLIENTS.iter().find(|c| c.id == id)
}

/// «claude.exe» → «claude»; «cli.js» → «cli».
fn stem(name: &str) -> String {
    let n = base_name(name).to_lowercase();
    [".exe", ".js", ".mjs", ".cjs", ".cmd"]
        .iter()
        .find_map(|ext| n.strip_suffix(ext).map(str::to_string))
        .unwrap_or(n)
}

impl KnownClient {
    fn matches(&self, p: &ProcInfo) -> bool {
        let mut names = vec![stem(&p.name)];
        names.extend(p.args.iter().take(2).map(|a| stem(a)));
        if names.iter().any(|n| self.names.contains(&n.as_str())) {
            return true;
        }
        p.args.iter().take(2).any(|a| {
            let a = a.to_lowercase().replace('\\', "/");
            self.path_hints.iter().any(|h| a.contains(h))
        })
    }
}

/// El asistente detectado: uno conocido o, si no, el primer programa que no es una shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detected {
    pub known: Option<&'static KnownClient>,
    pub id: String,
    pub name: String,
    /// El proceso del asistente (None si no se encontró ninguno).
    pub process: Option<ProcInfo>,
}

pub fn detect(chain: &[ProcInfo]) -> Option<Detected> {
    for p in chain {
        if let Some(k) = CLIENTS.iter().find(|k| k.matches(p)) {
            return Some(Detected { known: Some(k), id: k.id.into(), name: k.name.into(), process: Some(p.clone()) });
        }
    }
    let p = chain.iter().find(|p| !WRAPPERS.contains(&stem(&p.name).as_str()))?;
    let id = wire::clean_client_id(&stem(&p.name))?;
    Some(Detected { known: None, name: p.name.clone(), id, process: Some(p.clone()) })
}

/// Qué asistente es: `--client` (si no es «auto»), luego `SSHORUS_MCP_CLIENT`, luego la cadena de procesos.
pub fn resolve(flag: Option<&str>, env: Option<&str>, chain: &[ProcInfo]) -> Option<Detected> {
    let forced = flag.filter(|f| *f != "auto").or(env).and_then(wire::clean_client_id);
    let detected = detect(chain);
    let Some(id) = forced else { return detected };
    let known = by_id(&id);
    // El proceso solo se muestra si es el mismo asistente que se pidió.
    let process = detected.filter(|d| d.id == id).and_then(|d| d.process);
    Some(Detected { known, name: known.map(|k| k.name.to_string()).unwrap_or_else(|| id.clone()), id, process })
}
