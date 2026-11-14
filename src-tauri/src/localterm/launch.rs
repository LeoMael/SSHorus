//! Preparar el lanzamiento de un asistente: el MCP (puente y token), el archivo de contexto para
//! los que lo leen de un archivo, la versión del programa si importa, y el comando final.
//!
//! El archivo de contexto va en la caché de SSHorus (nunca en la carpeta del usuario), solo lo
//! puede leer el usuario y se borra al cerrar la pestaña (y los olvidados, al lanzar otro).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use portable_pty::CommandBuilder;
use tauri::{AppHandle, Manager};

use super::aicli::{self, SearchEnv};
use super::args::{self, LaunchInput, McpLaunch, PORT_ENV, TOKEN_ENV};
use super::env::{base_command, is_file};
use super::tools::{ContextVia, ToolSpec};
use super::AiLaunch;
use crate::error::{AppError, AppResult};
use crate::mcp::McpState;

/// Carpeta (dentro de la caché de SSHorus) de los archivos de contexto.
const CONTEXT_DIR: &str = "ai-context";
/// Archivos de contexto más viejos que esto se borran (pestañas que no se cerraron bien).
const CONTEXT_MAX_AGE: Duration = Duration::from_secs(2 * 24 * 3600);
/// Tiempo máximo para `programa --version`.
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

/// Asistente listo para lanzar.
pub struct Prepared {
    pub cmd: CommandBuilder,
    /// Ruta que se muestra al usuario.
    pub shown: PathBuf,
    /// Se configuró el MCP de SSHorus.
    pub mcp: bool,
    pub warning: Option<String>,
    /// Archivos que hay que borrar al cerrar la pestaña.
    pub temp_files: Vec<PathBuf>,
}

/// Prepara el MCP para el asistente: puente y token. Si no se puede, explica por qué.
async fn prepare_mcp(app: &AppHandle) -> Result<(McpLaunch, String, u16), String> {
    let state = app.state::<McpState>();
    let st = state.status();
    if !st.enabled {
        return Err("El MCP de SSHorus está apagado: el asistente se abrió solo con el contexto.".into());
    }
    if !st.running {
        let why = st.error.unwrap_or_else(|| "no está en marcha".into());
        return Err(format!("El MCP de SSHorus no está disponible ({why}): el asistente se abrió solo con el contexto."));
    }
    if !st.bridge_found {
        return Err(format!(
            "No se encontró el puente {} junto a SSHorus: el asistente se abrió solo con el contexto.",
            crate::mcp::bridge_file_name()
        ));
    }
    let token = crate::mcp::ensure_token(&state).await.map_err(|e| format!("No se pudo leer el token del MCP: {e}"))?;
    Ok((McpLaunch { bridge: st.bridge_path }, token.to_string(), st.port))
}

/// Escribe el contexto en `dir/<id>.md` (solo legible por el usuario) y borra los viejos.
pub fn write_context_file(dir: &Path, id: &str, text: &str) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    purge_old_files(dir, CONTEXT_MAX_AGE, SystemTime::now());
    let path = dir.join(format!("{id}.md"));
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    std::io::Write::write_all(&mut opts.open(&path)?, text.as_bytes())?;
    Ok(path)
}

/// Borra los `.md` de `dir` modificados hace más de `max_age`.
pub fn purge_old_files(dir: &Path, max_age: Duration, now: SystemTime) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > max_age);
        if old && p.extension().is_some_and(|x| x == "md") {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Contexto en un archivo de la caché de SSHorus, para los asistentes que lo leen así.
fn context_file(app: &AppHandle, spec: &ToolSpec, context: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(text) = args::usable_context(context).filter(|_| spec.context == ContextVia::InstructionsFile) else {
        return Ok(None);
    };
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("No se encontró la carpeta de caché: {e}"))?
        .join(CONTEXT_DIR);
    let id = uuid::Uuid::new_v4().to_string();
    write_context_file(&dir, &id, &text)
        .map(Some)
        .map_err(|e| format!("No se pudo preparar el contexto ({e}): el asistente se abrió sin él."))
}

/// Versión mayor del programa (`programa --version`), o None si no se sabe.
async fn major_version(program: &Path, prefix: &[String]) -> Option<u32> {
    let mut c = tokio::process::Command::new(program);
    c.args(prefix)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    let out = tokio::time::timeout(VERSION_TIMEOUT, c.output()).await.ok()?.ok()?;
    args::parse_major(&String::from_utf8_lossy(&out.stdout))
}

/// Une avisos (puede haber más de uno).
fn add_warning(w: &mut Option<String>, msg: String) {
    *w = Some(match w.take() {
        Some(prev) => format!("{prev} {msg}"),
        None => msg,
    });
}

/// Comando para abrir el asistente en `cwd`, con el contexto y (si se pide y se puede) el MCP.
pub async fn prepare(app: &AppHandle, env: &SearchEnv, l: &AiLaunch, cwd: &Path) -> AppResult<Prepared> {
    let spec = l.tool.spec();
    let resolved = aicli::resolve_tool(env, l.tool, &is_file)
        .ok_or_else(|| AppError::NotFound(format!("{} no está instalado en este equipo", spec.label)))?;
    let mut warning = None;

    let mcp = if l.mcp && spec.supports_mcp() {
        prepare_mcp(app).await.map_err(|w| add_warning(&mut warning, w)).ok()
    } else {
        None
    };
    let ctx_file = context_file(app, spec, l.context.as_deref()).unwrap_or_else(|w| {
        add_warning(&mut warning, w);
        None
    });
    let major_version = match spec.config_env {
        Some(_) => major_version(&resolved.program, &resolved.prefix).await,
        None => None,
    };
    let plan = args::launch_plan(
        spec,
        &LaunchInput {
            context: l.context.as_deref(),
            context_file: ctx_file.as_deref(),
            mcp: mcp.as_ref().map(|m| &m.0),
            major_version,
        },
    );

    // La carpeta del programa (y la de node) también van al PATH: el asistente lanza
    // sus propios procesos y debe encontrarse a sí mismo.
    let extra: Vec<PathBuf> =
        [&resolved.program, &resolved.shown].iter().filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    let mut cmd = base_command(&resolved.program, env, &extra, cwd)?;
    cmd.args(&resolved.prefix);
    cmd.args(&plan.args);
    for (k, v) in &plan.env {
        cmd.env(k, v);
    }
    if let Some((_, token, port)) = &mcp {
        cmd.env(TOKEN_ENV, token);
        cmd.env(PORT_ENV, port.to_string());
    }
    Ok(Prepared {
        cmd,
        shown: resolved.shown,
        mcp: mcp.is_some(),
        warning,
        temp_files: ctx_file.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sshorus-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn archivo_de_contexto_privado() {
        let dir = tmp("ctx");
        let p = write_context_file(&dir.join("ai-context"), "abc", "# Contexto").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Contexto");
        assert_eq!(p.file_name().unwrap(), "abc.md");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn borra_solo_los_viejos() {
        let dir = tmp("purge");
        std::fs::write(dir.join("a.md"), "x").unwrap();
        std::fs::write(dir.join("otro.txt"), "x").unwrap();
        // «Ahora» dentro de 3 días: a.md es viejo; otro.txt no se toca (no es nuestro).
        let later = SystemTime::now() + Duration::from_secs(3 * 24 * 3600);
        purge_old_files(&dir, CONTEXT_MAX_AGE, SystemTime::now());
        assert!(dir.join("a.md").exists(), "recién creado: se queda");
        purge_old_files(&dir, CONTEXT_MAX_AGE, later);
        assert!(!dir.join("a.md").exists());
        assert!(dir.join("otro.txt").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn avisos_juntos() {
        let mut w = None;
        add_warning(&mut w, "Uno.".into());
        add_warning(&mut w, "Dos.".into());
        assert_eq!(w.as_deref(), Some("Uno. Dos."));
    }
}
