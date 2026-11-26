//! Abrir una terminal local (la shell o un asistente) y saber qué asistentes hay instalados.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};

use super::aicli::{self, Os};
use super::env::{base_command, is_file, resolve_cwd, search_env, shell_command};
use super::tools::TOOLS;
use super::{launch, pty, AiToolInfo, LocalOpen, LocalOpened, LocalTermInfo, LocalTermStore};
use crate::error::{AppError, AppResult};
use crate::types::{TerminalExit, EV_TERMINAL_EXIT};

/// Carpeta personal, shell por defecto y sistema.
pub fn term_info() -> LocalTermInfo {
    let env = search_env();
    let (shell, _) = shell_command(&env);
    LocalTermInfo {
        home: dirs::home_dir().map(|h| h.display().to_string()).unwrap_or_default(),
        shell: shell.display().to_string(),
        os: match env.os {
            Os::Linux => "linux",
            Os::Mac => "mac",
            Os::Windows => "windows",
        }
        .into(),
    }
}

/// ¿Qué asistentes están instalados? (Solo busca los programas; no lee su configuración.)
pub fn detect_tools() -> Vec<AiToolInfo> {
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
}

/// Abre una terminal local: la shell del sistema o, con `launch`, un asistente de IA. La salida va
/// por `on_data`; al terminar se emite `EV_TERMINAL_EXIT` y se quita de `terms`.
pub async fn open(
    app: &AppHandle,
    terms: &LocalTermStore,
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
        Some(l) => launch::prepare(app, &env, l, &cwd).await?,
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
