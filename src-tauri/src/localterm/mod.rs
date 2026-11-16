//! Terminal local: pestañas con una shell **del propio equipo** (no de un servidor), y lanzar
//! asistentes de IA (Claude Code, Codex, Antigravity/agy, OpenCode) con el contexto de SSHorus y,
//! en los que lo admiten, su MCP ya configurado.
//!
//! Igual que las terminales SSH: la salida llega por el `Channel` de `local_term_open` (bytes
//! crudos) y, al terminar, se emite `EV_TERMINAL_EXIT` con el id. Así la interfaz usa la misma vista.
//!
//! Lo que SSHorus NUNCA hace aquí: leer o copiar la configuración de los asistentes (`~/.claude`,
//! `~/.codex`, `~/.gemini`, `~/.config/opencode`…), escribir archivos en la carpeta del usuario,
//! ni poner el token del MCP en un archivo o en los argumentos (va por variable de entorno al
//! proceso hijo).
//!
//! Archivos: `tools` (los asistentes, como datos) · `aicli` (dónde están) · `args` (con qué
//! argumentos se abren) · `launch` (MCP, contexto y comando final) · `env` (entorno del proceso) ·
//! `pty` (la terminal) · `state` (carpeta actual de la shell) · `aliases` (alias de `~/.ssh/config`).

pub mod aicli;
pub mod aliases;
pub mod args;
pub mod env;
pub mod launch;
pub mod pty;
pub mod state;
pub mod tools;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::storage::ssh_config::{load_overrides, SshEnv};
use crate::storage::ProfileStore;
use crate::types::{TerminalExit, EV_TERMINAL_EXIT};
use aicli::Os;
use env::{base_command, is_file, resolve_cwd, search_env, shell_command};
use pty::LocalPty;
use tools::{AiTool, TOOLS};

// ───────────────────────── Ajustes ─────────────────────────

/// Ajustes de la terminal local y de los asistentes (Ajustes → Terminal local e IA).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalAiSettings {
    /// Cómo trabaja el asistente con los servidores: "both" | "direct" (ssh) | "mcp".
    pub mode: String,
    /// Incluir la lista de servidores (nombre, alias, usuario…).
    pub include_servers: bool,
    /// Incluir host y puerto de cada servidor.
    pub include_hosts: bool,
    /// Incluir los proyectos.
    pub include_projects: bool,
    /// Incluir la pestaña que se estaba mirando.
    pub include_active: bool,
    /// Incluir la fecha.
    pub include_date: bool,
    /// Última carpeta elegida para abrir terminales locales (None = carpeta personal).
    pub last_cwd: Option<String>,
}

impl Default for LocalAiSettings {
    fn default() -> Self {
        LocalAiSettings {
            mode: "both".into(),
            include_servers: true,
            include_hosts: true,
            include_projects: true,
            include_active: true,
            include_date: true,
            last_cwd: None,
        }
    }
}

impl LocalAiSettings {
    pub fn sanitized(mut self) -> Self {
        if !matches!(self.mode.as_str(), "both" | "direct" | "mcp") {
            self.mode = "both".into();
        }
        if self.last_cwd.as_deref().is_some_and(|c| c.trim().is_empty()) {
            self.last_cwd = None;
        }
        self
    }
}

// ───────────────────────── Estado ─────────────────────────

/// Terminales locales abiertas: termId → PTY.
#[derive(Default)]
pub struct LocalTermStore {
    terms: Mutex<HashMap<String, LocalPty>>,
}

impl LocalTermStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, LocalPty>> {
        self.terms.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, id: &str) -> AppResult<LocalPty> {
        self.lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))
    }

    /// Cierra todas (al cerrar la app).
    pub fn close_all(&self) {
        for (_, t) in self.lock().drain() {
            t.close();
        }
    }
}

// ───────────────────────── Tipos de la interfaz ─────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTermInfo {
    pub home: String,
    /// Shell que se abre por defecto.
    pub shell: String,
    /// "linux" | "mac" | "windows"
    pub os: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolInfo {
    pub tool: AiTool,
    pub label: String,
    pub installed: bool,
    pub path: Option<String>,
    /// Comando oficial para instalarlo en este sistema.
    pub install_command: String,
    /// Hace falta Node.js (npm) para instalarlo.
    pub needs_node: bool,
    /// Hay npm (para el aviso «falta Node.js»).
    pub npm_found: bool,
    /// Se le puede configurar el MCP de SSHorus sin tocar sus archivos.
    pub supports_mcp: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLaunch {
    pub tool: AiTool,
    /// Contexto de SSHorus (lo arma la interfaz; nunca lleva secretos).
    pub context: Option<String>,
    /// Configurar el MCP de SSHorus.
    pub mcp: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOpen {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Sin esto se abre la shell.
    pub launch: Option<AiLaunch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOpened {
    pub term_id: String,
    pub cwd: String,
    /// Programa que corre (ruta).
    pub program: String,
    /// El asistente se abrió con el MCP de SSHorus.
    pub mcp: bool,
    /// Algo no salió como se pidió (p. ej. el MCP está apagado y se abrió solo con el contexto).
    pub warning: Option<String>,
}

// ───────────────────────── Comandos ─────────────────────────

#[tauri::command]
pub async fn local_term_info() -> AppResult<LocalTermInfo> {
    let env = search_env();
    let (shell, _) = shell_command(&env);
    Ok(LocalTermInfo {
        home: dirs::home_dir().map(|h| h.display().to_string()).unwrap_or_default(),
        shell: shell.display().to_string(),
        os: match env.os {
            Os::Linux => "linux",
            Os::Mac => "mac",
            Os::Windows => "windows",
        }
        .into(),
    })
}

/// ¿Qué asistentes están instalados? (Solo busca los programas; no lee su configuración.)
#[tauri::command]
pub async fn local_ai_detect() -> AppResult<Vec<AiToolInfo>> {
    tokio::task::spawn_blocking(|| {
        let env = search_env();
        let npm_found = aicli::find_program(&env, "npm", &is_file).is_some();
        TOOLS
            .iter()
            .map(|spec| {
                let r = aicli::resolve_tool(&env, spec.tool, &is_file);
                let install = spec.install(env.os);
                AiToolInfo {
                    tool: spec.tool,
                    label: spec.label.into(),
                    installed: r.is_some(),
                    path: r.map(|r| r.shown.display().to_string()),
                    install_command: install.command.into(),
                    needs_node: install.needs_node,
                    npm_found,
                    supports_mcp: spec.supports_mcp(),
                }
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))
}

/// Alias de `~/.ssh/config` exportados por SSHorus que de verdad llevan a cada servidor.
#[tauri::command]
pub async fn local_ai_ssh_aliases(store: State<'_, ProfileStore>) -> AppResult<Vec<aliases::ExportedAlias>> {
    let servers = store.data().servers;
    tokio::task::spawn_blocking(move || {
        let env = SshEnv::user()?;
        let text = match std::fs::read_to_string(&env.config) {
            Ok(t) => t,
            Err(_) => return Ok(Vec::new()),
        };
        Ok(aliases::exported_aliases(&text, &servers, &load_overrides(&env)))
    })
    .await
    .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?
}

/// Abre una terminal local: la shell del sistema o, con `launch`, un asistente de IA.
#[tauri::command]
pub async fn local_term_open(
    app: AppHandle,
    terms: State<'_, LocalTermStore>,
    opts: LocalOpen,
    on_data: Channel<InvokeResponseBody>,
) -> AppResult<LocalOpened> {
    let cwd = resolve_cwd(opts.cwd.as_deref())?;
    let env = tokio::task::spawn_blocking(search_env)
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))?;

    let prepared = match &opts.launch {
        None => {
            let (shell, args) = shell_command(&env);
            let mut cmd = base_command(&shell, &env, &[], &cwd)?;
            cmd.args(&args);
            launch::Prepared { cmd, shown: shell, mcp: false, warning: None, temp_files: Vec::new() }
        }
        Some(l) => launch::prepare(&app, &env, l, &cwd).await?,
    };
    let launch::Prepared { cmd, shown, mcp: with_mcp, warning, temp_files } = prepared;

    let term_id = uuid::Uuid::new_v4().to_string();
    let exit_id = term_id.clone();
    let app2 = app.clone();
    let handle = pty::spawn(
        cmd,
        opts.cols,
        opts.rows,
        move |bytes| {
            if let Err(e) = on_data.send(InvokeResponseBody::Raw(bytes)) {
                log::debug!("terminal local: no se pudo enviar a la interfaz: {e}");
            }
        },
        move |code| {
            for f in &temp_files {
                let _ = std::fs::remove_file(f);
            }
            app2.state::<LocalTermStore>().lock().remove(&exit_id);
            let _ = app2.emit(EV_TERMINAL_EXIT, TerminalExit { term_id: exit_id, code });
        },
    )?;
    {
        let mut map = terms.lock();
        if !handle.is_finished() {
            map.insert(term_id.clone(), handle);
        }
    }
    Ok(LocalOpened {
        term_id,
        cwd: cwd.display().to_string(),
        program: shown.display().to_string(),
        mcp: with_mcp,
        warning,
    })
}

#[tauri::command]
pub async fn local_term_write(terms: State<'_, LocalTermStore>, term_id: String, data: String) -> AppResult<()> {
    terms.get(&term_id)?.write(data.into_bytes())
}

#[tauri::command]
pub async fn local_term_resize(terms: State<'_, LocalTermStore>, term_id: String, cols: u16, rows: u16) -> AppResult<()> {
    terms.get(&term_id)?.resize(cols, rows)
}

/// Cierra la terminal: termina el programa y todo lo que lanzó.
#[tauri::command]
pub async fn local_term_close(terms: State<'_, LocalTermStore>, term_id: String) -> AppResult<()> {
    match terms.lock().remove(&term_id) {
        Some(t) => {
            t.close();
            Ok(())
        }
        None => Err(AppError::NotFound(format!("terminal {term_id}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn ajustes_saneados() {
        let s = LocalAiSettings { mode: "otro".into(), last_cwd: Some("  ".into()), ..Default::default() }.sanitized();
        assert_eq!(s.mode, "both");
        assert_eq!(s.last_cwd, None);
        // Un settings.json antiguo (sin `localAi`) se lee con los valores por defecto.
        let st: crate::types::Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(st.local_ai, LocalAiSettings::default());
    }

    /// Ejecuta el programa real con los argumentos que usaría SSHorus (solo si está instalado).
    /// `cargo test --lib localterm::tests::asistentes_reales -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn asistentes_reales() {
        let env = search_env();
        // `plan`: con los argumentos de SSHorus (contexto y MCP) o solo con `extra`.
        let run = |tool: AiTool, plan: bool, extra: &[&str]| -> Option<String> {
            let r = aicli::resolve_tool(&env, tool, &is_file)?;
            let home = dirs::home_dir().unwrap();
            let mut cmd = base_command(&r.program, &env, &[], &home).unwrap();
            cmd.args(&r.prefix);
            if plan {
                let m = args::McpLaunch { bridge: "/opt/sshorus/sshorus-mcp".into() };
                let input = args::LaunchInput {
                    context: Some("Contexto \"de\" prueba\ncon dos líneas"),
                    mcp: Some(&m),
                    ..Default::default()
                };
                let p = args::launch_plan(tool.spec(), &input);
                cmd.args(&p.args);
                for (k, v) in &p.env {
                    cmd.env(k, v);
                }
            }
            cmd.args(extra);
            let (tx, rx) = mpsc::channel::<Vec<u8>>();
            let (etx, erx) = mpsc::channel::<Option<u32>>();
            let on_data = move |b| {
                let _ = tx.send(b);
            };
            let _t = pty::spawn(cmd, 200, 50, on_data, move |c| {
                let _ = etx.send(c);
            })
            .unwrap();
            let code = erx.recv_timeout(Duration::from_secs(30)).expect("no terminó");
            let out = String::from_utf8_lossy(&rx.try_iter().flatten().collect::<Vec<u8>>()).to_string();
            println!("{tool:?} → código {code:?}\n{out}");
            Some(out)
        };
        // Codex: los -c se aplican y el servidor MCP queda con env_vars (sin token en la configuración).
        if let Some(out) = run(AiTool::Codex, true, &["mcp", "get", "sshorus", "--json"]) {
            assert!(out.contains("SSHORUS_MCP_TOKEN"), "codex no recibió env_vars");
            assert!(out.contains("/opt/sshorus/sshorus-mcp"));
            assert!(out.contains("900"));
        }
        if let Some(out) = run(AiTool::Claude, true, &["--version"]) {
            assert!(out.contains("Claude Code"));
        }
        // agy y OpenCode: que se encuentran y arrancan (sin tocar su configuración).
        for tool in [AiTool::Agy, AiTool::OpenCode] {
            if let Some(out) = run(tool, false, &["--version"]) {
                assert!(args::parse_major(&out).is_some(), "{tool:?}: versión no reconocida");
            }
        }
    }
}
