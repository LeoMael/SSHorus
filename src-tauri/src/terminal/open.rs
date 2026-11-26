//! Abrir una terminal: elegir entre shell normal y tmux, arrancarla y registrarla.

use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};

use super::tmux::{self, ProbeResult};
use super::{spawn_terminal, ShellStart, TerminalStore};
use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use crate::types::{TermOpened, TerminalExit, TmuxOpen, EV_TERMINAL_EXIT};

/// Decide cómo arrancar la terminal según la petición de tmux y lo que hay en el servidor.
async fn choose_start(
    terms: &TerminalStore,
    session_id: &str,
    session: &SshSession,
    req: Option<TmuxOpen>,
    rows: u32,
    opened: &mut TermOpened,
) -> AppResult<ShellStart> {
    let Some(req) = req else { return Ok(ShellStart::Shell) };
    if !tmux::valid_name(&req.name) {
        return Err(AppError::Invalid(format!("nombre de sesión tmux no válido: {}", req.name)));
    }
    match terms.probe_tmux(session_id, session).await {
        Ok(ProbeResult::Found(p)) if p.supported() => {
            if req.check_existing {
                opened.tmux_reattached = tmux::has_session(session, &p, &req.name).await;
            }
            let cmd = tmux::attach_command(&p, &req.name, rows, req.replay)?;
            opened.tmux = Some(req.name);
            Ok(ShellStart::Exec(cmd))
        }
        Ok(ProbeResult::Found(p)) => {
            opened.tmux_problem = Some(format!(
                "la versión de tmux del servidor ({}) es muy antigua: hace falta la 1.8 o una más nueva",
                p.version_text
            ));
            Ok(ShellStart::Shell)
        }
        Ok(ProbeResult::NotInstalled) => {
            opened.tmux_missing = true;
            opened.tmux_problem = Some("tmux no está instalado en el servidor".into());
            Ok(ShellStart::Shell)
        }
        Err(e) => {
            log::info!("terminal: no se pudo comprobar tmux: {e}");
            opened.tmux_problem = Some(format!("no se pudo comprobar si hay tmux: {e}"));
            Ok(ShellStart::Shell)
        }
    }
}

/// Abre una shell interactiva en `session` (ver el comando `term_open`). La salida va por
/// `on_data`; al terminar se emite `EV_TERMINAL_EXIT` y se quita de `terms`.
#[allow(clippy::too_many_arguments)]
pub async fn open(
    app: AppHandle,
    terms: &TerminalStore,
    session: Arc<SshSession>,
    session_id: String,
    cols: u32,
    rows: u32,
    tmux: Option<TmuxOpen>,
    on_data: Channel<InvokeResponseBody>,
) -> AppResult<TermOpened> {
    let term_id = uuid::Uuid::new_v4().to_string();
    let mut opened = TermOpened {
        term_id: term_id.clone(),
        tmux: None,
        tmux_reattached: false,
        tmux_missing: false,
        tmux_problem: None,
    };
    let start = choose_start(terms, &session_id, &session, tmux, rows, &mut opened).await?;

    let exit_id = term_id.clone();
    let handle = spawn_terminal(
        session,
        start,
        cols,
        rows,
        move |bytes| {
            if let Err(e) = on_data.send(InvokeResponseBody::Raw(bytes)) {
                log::debug!("terminal: no se pudo enviar a la interfaz: {e}");
            }
        },
        move |code| {
            app.state::<TerminalStore>().remove(&exit_id);
            let _ = app.emit(
                EV_TERMINAL_EXIT,
                TerminalExit {
                    term_id: exit_id,
                    code,
                },
            );
        },
    )
    .await?;

    terms.insert(term_id, session_id, handle);
    Ok(opened)
}
