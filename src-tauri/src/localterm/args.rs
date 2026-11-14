//! Argumentos y variables de entorno con los que se abre un asistente, según lo que diga su
//! `ToolSpec` (cómo recibe el contexto y el MCP). Lógica pura, con pruebas.
//!
//! - Claude Code: `--append-system-prompt <texto>` y `--mcp-config <json>` (el JSON va en el propio
//!   argumento; el token NO va dentro: el puente lo lee de la variable de entorno que hereda).
//! - Codex: `-c developer_instructions="…"` y `-c mcp_servers.sshorus.*` con
//!   `env_vars = ["SSHORUS_MCP_TOKEN", …]` para que Codex le pase el token al puente.
//! - OpenCode: `OPENCODE_CONFIG_CONTENT` con `mcp.sshorus` y `instructions` (un archivo de SSHorus
//!   en su carpeta de caché, no en la del usuario). Con `--standalone`, para que lo lea un servidor
//!   propio (el servicio compartido no ve el entorno de esta pestaña). El puente hereda el token.
//! - agy: no admite instrucciones del sistema ni MCP sin tocar sus archivos: el contexto va como
//!   primer mensaje (`-i`) y el MCP no se configura.

use std::path::Path;

use serde_json::{json, Map, Value};

use super::tools::{ContextVia, McpVia, ToolSpec};

/// Variable con el token del MCP (la lee el puente `sshorus-mcp`).
pub const TOKEN_ENV: &str = "SSHORUS_MCP_TOKEN";
/// Variable con el puerto del MCP.
pub const PORT_ENV: &str = "SSHORUS_MCP_PORT";
/// Nombre del servidor MCP en los asistentes.
pub const MCP_NAME: &str = "sshorus";
/// Codex corta una herramienta MCP a los 60 s por defecto; una aprobación puede tardar más.
pub const CODEX_TOOL_TIMEOUT_SECS: u32 = 900;
/// Límite del contexto (la línea de órdenes de Windows admite ~32 000 caracteres en total).
pub const MAX_CONTEXT_CHARS: usize = 12_000;
/// Final del primer mensaje cuando el contexto va como mensaje (no como instrucciones).
pub const FIRST_MESSAGE_TAIL: &str =
    "Esto es solo contexto: no hagas nada todavía. Responde solo «Listo» y espera mi petición.";

/// MCP de SSHorus para el asistente (el token va aparte, por variable de entorno).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLaunch {
    /// Ruta del puente `sshorus-mcp`.
    pub bridge: String,
}

/// Lo que se sabe al lanzar.
#[derive(Debug, Clone, Default)]
pub struct LaunchInput<'a> {
    /// Contexto de SSHorus (sin limpiar).
    pub context: Option<&'a str>,
    /// Archivo con el contexto, para los que lo leen de un archivo (`ContextVia::InstructionsFile`).
    pub context_file: Option<&'a Path>,
    pub mcp: Option<&'a McpLaunch>,
    /// Versión mayor del programa, si se sabe.
    pub major_version: Option<u32>,
}

/// Argumentos y variables de entorno para el asistente.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchPlan {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Quita caracteres de control (salvo saltos de línea y tabuladores) y recorta el tamaño.
pub fn clean_context(text: &str) -> String {
    let mut s: String = text
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect();
    if s.chars().count() > MAX_CONTEXT_CHARS {
        s = s.chars().take(MAX_CONTEXT_CHARS).collect();
        s.push_str("\n[…contexto recortado]");
    }
    s.trim().to_string()
}

/// El contexto limpio, o nada si queda vacío.
pub fn usable_context(context: Option<&str>) -> Option<String> {
    context.map(clean_context).filter(|c| !c.is_empty())
}

/// Cadena TOML básica entre comillas (para los `-c clave=valor` de Codex).
pub fn toml_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Ruta para `instructions` de OpenCode: admite comodines, así que siempre con `/`.
fn instructions_path(p: &Path) -> String {
    p.display().to_string().replace('\\', "/")
}

/// Contexto → argumentos o configuración.
fn add_context(via: ContextVia, ctx: &str, input: &LaunchInput, plan: &mut LaunchPlan, config: &mut Map<String, Value>) {
    match via {
        ContextVia::SystemPromptFlag(flag) => {
            plan.args.push(flag.into());
            plan.args.push(ctx.into());
        }
        ContextVia::CodexInstructions => {
            plan.args.push("-c".into());
            plan.args.push(format!("developer_instructions={}", toml_string(ctx)));
        }
        ContextVia::InstructionsFile => {
            if let Some(f) = input.context_file {
                config.insert("instructions".into(), json!([instructions_path(f)]));
            }
        }
        ContextVia::FirstMessage(flag) => {
            plan.args.push(flag.into());
            plan.args.push(format!("{ctx}\n\n{FIRST_MESSAGE_TAIL}"));
        }
    }
}

/// MCP → argumentos o configuración.
fn add_mcp(via: McpVia, m: &McpLaunch, plan: &mut LaunchPlan, config: &mut Map<String, Value>) {
    match via {
        McpVia::ClaudeConfigFlag => {
            let cfg = json!({ "mcpServers": { MCP_NAME: { "type": "stdio", "command": m.bridge, "args": [] } } });
            plan.args.push("--mcp-config".into());
            plan.args.push(cfg.to_string());
        }
        McpVia::CodexConfig => {
            let key = format!("mcp_servers.{MCP_NAME}");
            let pairs = [
                format!("{key}.command={}", toml_string(&m.bridge)),
                format!("{key}.args=[]"),
                // Codex no pasa todo el entorno a los servidores MCP: hay que nombrar las variables.
                format!("{key}.env_vars=[{}, {}]", toml_string(TOKEN_ENV), toml_string(PORT_ENV)),
                format!("{key}.tool_timeout_sec={CODEX_TOOL_TIMEOUT_SECS}"),
            ];
            for p in pairs {
                plan.args.push("-c".into());
                plan.args.push(p);
            }
        }
        McpVia::ConfigEnv => {
            // Forma «local» de OpenCode (la entienden la v1 y la v2). Sin `environment`: el puente
            // hereda el entorno de OpenCode, con el token.
            config.insert(
                "mcp".into(),
                json!({ MCP_NAME: { "type": "local", "command": [m.bridge], "enabled": true } }),
            );
        }
        McpVia::Unsupported => {}
    }
}

/// Argumentos y entorno del asistente.
pub fn launch_plan(spec: &ToolSpec, input: &LaunchInput) -> LaunchPlan {
    let mut plan = LaunchPlan::default();
    let mut config = Map::new();
    if let Some(ctx) = usable_context(input.context) {
        add_context(spec.context, &ctx, input, &mut plan, &mut config);
    }
    if let Some(m) = input.mcp {
        add_mcp(spec.mcp, m, &mut plan, &mut config);
    }
    if let Some(ce) = spec.config_env.filter(|_| !config.is_empty()) {
        plan.env.push((ce.var.into(), Value::Object(config).to_string()));
        // Si no se sabe la versión, se supone la actual.
        if input.major_version.is_none_or(|v| v >= ce.flag_since_major) {
            plan.args.insert(0, ce.private_server_flag.into());
        }
    }
    plan
}

/// Versión mayor a partir de la salida de `--version` («opencode v2.2.5», «1.5.8»…).
pub fn parse_major(out: &str) -> Option<u32> {
    out.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|w| w.contains('.') && w.starts_with(|c: char| c.is_ascii_digit()))
        .and_then(|w| w.split('.').next())
        .and_then(|m| m.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::localterm::tools::AiTool;
    use std::path::PathBuf;

    fn plan(tool: AiTool, ctx: Option<&str>, file: Option<&Path>, mcp: Option<&McpLaunch>, ver: Option<u32>) -> LaunchPlan {
        launch_plan(tool.spec(), &LaunchInput { context: ctx, context_file: file, mcp, major_version: ver })
    }

    #[test]
    fn claude_con_contexto_y_mcp() {
        let m = McpLaunch { bridge: "/opt/SSHorus/sshorus-mcp".into() };
        let p = plan(AiTool::Claude, Some("Hola\nmundo"), None, Some(&m), None);
        let a = &p.args;
        assert_eq!(a[0], "--append-system-prompt");
        assert_eq!(a[1], "Hola\nmundo");
        assert_eq!(a[2], "--mcp-config");
        let v: serde_json::Value = serde_json::from_str(&a[3]).unwrap();
        assert_eq!(v["mcpServers"]["sshorus"]["command"], "/opt/SSHorus/sshorus-mcp");
        assert_eq!(v["mcpServers"]["sshorus"]["type"], "stdio");
        // El token nunca va en los argumentos.
        assert!(!a[3].contains("TOKEN") && !a[3].contains("env"));
        assert_eq!(a.len(), 4);
        assert!(p.env.is_empty());
    }

    #[test]
    fn sin_nada_no_hay_argumentos() {
        for t in [AiTool::Claude, AiTool::Codex, AiTool::Agy, AiTool::OpenCode] {
            assert_eq!(plan(t, None, None, None, None), LaunchPlan::default(), "{t:?}");
            assert_eq!(plan(t, Some("  \n "), None, None, None), LaunchPlan::default(), "{t:?} vacío");
        }
    }

    #[test]
    fn codex_con_contexto_y_mcp() {
        let m = McpLaunch { bridge: r#"C:\Program Files\SSHorus\sshorus-mcp.exe"#.into() };
        let p = plan(AiTool::Codex, Some("Línea \"uno\"\n\tdos"), None, Some(&m), None);
        assert_eq!(
            p.args,
            vec![
                "-c",
                r#"developer_instructions="Línea \"uno\"\n\tdos""#,
                "-c",
                r#"mcp_servers.sshorus.command="C:\\Program Files\\SSHorus\\sshorus-mcp.exe""#,
                "-c",
                "mcp_servers.sshorus.args=[]",
                "-c",
                r#"mcp_servers.sshorus.env_vars=["SSHORUS_MCP_TOKEN", "SSHORUS_MCP_PORT"]"#,
                "-c",
                "mcp_servers.sshorus.tool_timeout_sec=900",
            ]
        );
    }

    #[test]
    fn agy_contexto_como_primer_mensaje_y_sin_mcp() {
        let m = McpLaunch { bridge: "/opt/sshorus-mcp".into() };
        let p = plan(AiTool::Agy, Some("# Contexto"), None, Some(&m), None);
        assert_eq!(p.args.len(), 2);
        assert_eq!(p.args[0], "-i");
        assert!(p.args[1].starts_with("# Contexto\n\n"));
        assert!(p.args[1].ends_with(FIRST_MESSAGE_TAIL));
        // Ni rastro del MCP: agy solo lo lee de sus archivos.
        assert!(!p.args.iter().any(|a| a.contains("sshorus-mcp")));
        assert!(p.env.is_empty());
    }

    #[test]
    fn opencode_por_variable_de_entorno() {
        let m = McpLaunch { bridge: "/opt/sshorus-mcp".into() };
        let f = PathBuf::from("/home/ana/.cache/sshorus/ai-context/abc.md");
        let p = plan(AiTool::OpenCode, Some("# Contexto"), Some(&f), Some(&m), Some(2));
        assert_eq!(p.args, vec!["--standalone"]);
        assert_eq!(p.env.len(), 1);
        assert_eq!(p.env[0].0, "OPENCODE_CONFIG_CONTENT");
        let v: serde_json::Value = serde_json::from_str(&p.env[0].1).unwrap();
        assert_eq!(v["mcp"]["sshorus"]["type"], "local");
        assert_eq!(v["mcp"]["sshorus"]["command"], json!(["/opt/sshorus-mcp"]));
        assert_eq!(v["mcp"]["sshorus"]["enabled"], true);
        assert_eq!(v["instructions"], json!(["/home/ana/.cache/sshorus/ai-context/abc.md"]));
        // El contexto no va en la línea de órdenes, y el token no va en ningún sitio.
        assert!(!p.env[0].1.contains("# Contexto") && !p.env[0].1.contains("TOKEN"));
    }

    #[test]
    fn opencode_version_1_sin_servidor_propio() {
        let m = McpLaunch { bridge: "/opt/sshorus-mcp".into() };
        let p = plan(AiTool::OpenCode, None, None, Some(&m), Some(1));
        assert!(p.args.is_empty());
        assert_eq!(p.env.len(), 1);
        // Versión desconocida: se supone la actual.
        assert_eq!(plan(AiTool::OpenCode, None, None, Some(&m), None).args, vec!["--standalone"]);
    }

    #[test]
    fn opencode_ruta_de_windows_con_barras() {
        let f = PathBuf::from(r"C:\Users\ana\AppData\Local\sshorus\ai-context\abc.md");
        let p = plan(AiTool::OpenCode, Some("x"), Some(&f), None, Some(2));
        let v: serde_json::Value = serde_json::from_str(&p.env[0].1).unwrap();
        assert_eq!(v["instructions"], json!(["C:/Users/ana/AppData/Local/sshorus/ai-context/abc.md"]));
        assert!(v.get("mcp").is_none());
    }

    #[test]
    fn version_mayor() {
        assert_eq!(parse_major("opencode v2.2.5\n"), Some(2));
        assert_eq!(parse_major("1.5.8"), Some(1));
        assert_eq!(parse_major("0.15.3 (abc)"), Some(0));
        assert_eq!(parse_major("sin versión"), None);
        assert_eq!(parse_major(""), None);
    }

    #[test]
    fn toml_escapa_controles() {
        assert_eq!(toml_string("a\u{7f}b\u{1}"), "\"a\\u007Fb\\u0001\"");
        assert_eq!(toml_string(r"c:\x"), r#""c:\\x""#);
    }

    #[test]
    fn contexto_limpio_y_recortado() {
        assert_eq!(clean_context("a\u{1b}[31mb\r\nc"), "a[31mb\nc");
        let big = "x".repeat(MAX_CONTEXT_CHARS + 50);
        let c = clean_context(&big);
        assert!(c.ends_with("[…contexto recortado]"));
        assert!(c.chars().count() < MAX_CONTEXT_CHARS + 40);
    }
}
