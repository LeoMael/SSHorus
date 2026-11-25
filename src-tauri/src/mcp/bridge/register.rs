//! Registrar el puente en la configuración del asistente, sin token (el token va en el llavero).
//!
//! Con los asistentes que tienen línea de comandos (`claude mcp add`, `codex mcp add`, `gemini mcp add`) se
//! usa esa: es su forma documentada y no toca nada más de su configuración. Solo se reemplaza una entrada
//! llamada «sshorus» (la nuestra). Con el resto se imprime el bloque exacto para pegar.

use std::path::Path;
use std::process::Command;

use serde_json::json;

use super::clients::{KnownClient, Setup, Snippet};
use super::wire::CLIENT_ENV;

/// Dónde se registra (los asistentes que no lo distinguen lo ignoran).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    User,
    Project,
}

impl Scope {
    pub fn parse(s: &str) -> Option<Scope> {
        match s {
            "user" => Some(Scope::User),
            "project" => Some(Scope::Project),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project => "project",
        }
    }
}

/// Resultado del registro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Registered {
    /// Se ejecutó este comando y funcionó.
    Done { command: String },
    /// No se pudo hacer solo: hay que hacerlo a mano con estas instrucciones.
    Manual { why: Option<String>, instructions: String },
}

/// Argumentos con `{scope}`, `{env}` y `{path}` sustituidos.
pub fn fill(template: &[&str], scope: Scope, client_id: &str, path: &str) -> Vec<String> {
    template
        .iter()
        .map(|a| match *a {
            "{scope}" => scope.as_str().to_string(),
            "{env}" => format!("{CLIENT_ENV}={client_id}"),
            "{path}" => path.to_string(),
            other => other.to_string(),
        })
        .collect()
}

/// Línea para copiar en una shell.
pub fn shell_line(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string()).chain(args.iter().map(|a| shell_quote(a))).collect::<Vec<_>>().join(" ")
}

/// Un argumento listo para pegar en la shell de esta plataforma (sin comillas si no hacen falta).
pub fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-./:=@\\".contains(&b)) {
        s.to_string()
    } else if cfg!(windows) {
        format!("\"{s}\"")
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// Bloque JSON para pegar en el archivo de configuración del asistente.
pub fn snippet(kind: Snippet, client_id: &str, path: &str) -> String {
    let (file, value) = match kind {
        Snippet::McpServers { file } => (
            file,
            json!({ "mcpServers": { "sshorus": { "command": path, "args": [], "env": { CLIENT_ENV: client_id } } } }),
        ),
        Snippet::OpenCode { file } => (
            file,
            json!({ "mcp": { "sshorus": {
                "type": "local", "command": [path], "enabled": true, "environment": { CLIENT_ENV: client_id }
            } } }),
        ),
    };
    let body = serde_json::to_string_pretty(&value).unwrap_or_default();
    format!("Añade esto a {file} (junto a lo que ya tengas, sin borrarlo):\n{body}")
}

/// Registra el puente para este asistente (o explica cómo hacerlo a mano).
pub fn register(client: Option<&KnownClient>, client_id: &str, scope: Scope, bridge: &Path) -> Registered {
    let path = bridge.display().to_string();
    let Some(client) = client else {
        return Registered::Manual {
            why: Some("no se reconoció el asistente".into()),
            instructions: snippet(Snippet::McpServers { file: "la configuración MCP de tu asistente" }, client_id, &path),
        };
    };
    match client.setup {
        Setup::Manual(kind) => Registered::Manual { why: None, instructions: snippet(kind, client_id, &path) },
        Setup::Cli { program, add, remove, scoped } => {
            let scope = if scoped { scope } else { Scope::User };
            let add = fill(add, scope, client_id, &path);
            let line = shell_line(program, &add);
            match run_cli(program, &add, &fill(remove, scope, client_id, &path)) {
                Ok(()) => Registered::Done { command: line },
                Err(why) => Registered::Manual { why: Some(why), instructions: format!("Ejecuta:\n  {line}") },
            }
        }
    }
}

/// `add`; si ya existe una entrada «sshorus», se quita y se vuelve a añadir.
fn run_cli(program: &str, add: &[String], remove: &[String]) -> Result<(), String> {
    let first = run(program, add)?;
    if first.0 {
        return Ok(());
    }
    if !first.1.to_lowercase().contains("already exists") {
        return Err(first.1);
    }
    run(program, remove)?;
    match run(program, add)? {
        (true, _) => Ok(()),
        (false, err) => Err(err),
    }
}

/// (salió bien, texto del error).
fn run(program: &str, args: &[String]) -> Result<(bool, String), String> {
    let out = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("no se pudo ejecutar «{program}»: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stderr), String::from_utf8_lossy(&out.stdout));
    Ok((out.status.success(), text.trim().chars().take(400).collect()))
}
