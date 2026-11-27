//! «Claude Code en este servidor con tu cuenta» (botón de la terminal SSH): lleva la cuenta de Claude
//! Code del PC al usuario con el que se entró en el servidor, sin iniciar sesión por navegador allí.
//!
//! - «Copiar mi sesión»: el motor lee `~/.claude/.credentials.json` del PC **en el momento de enviarla**,
//!   se queda solo con `claudeAiOauth` y la manda. Nunca pasa por la interfaz web.
//! - «Llave de acceso»: la llave de `claude setup-token` que el usuario pegó; se comprueba su forma y se
//!   manda.
//!
//! Cómo viaja el secreto: por la entrada estándar de un canal exec de la sesión ya abierta, detrás del
//! script fijo de `scripts` (nunca en la línea de comandos, el entorno, archivos temporales del PC ni
//! registros). En memoria va en `Zeroizing` y se pisa con ceros al terminar. La salida del script no lo
//! lleva (lo lee `cat` directo al archivo), y aun así no se devuelve tal cual.
//! El MCP de SSHorus no tiene herramienta para esto ni ve estos comandos.

mod creds;
mod scripts;
#[cfg(test)]
mod tests;

use std::path::Path;

use serde::Serialize;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::snippets::exec;
use crate::ssh::SshSession;
use crate::types::ExecResult;

pub use creds::{local_creds_path, normalize_token};

const TIMEOUT_SECS: u32 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeVpsSent {
    /// El servidor ya tenía una sesión de Claude Code: se guardó para reponerla al quitar la cuenta.
    pub backup: bool,
}

/// «Copiar mi sesión»: lee la sesión de `creds_path` y la deja en el servidor.
pub async fn copy_session(session: &SshSession, creds_path: &Path) -> AppResult<ClaudeVpsSent> {
    let path = creds_path.to_path_buf();
    let oauth = tokio::task::spawn_blocking(move || creds::read_oauth(&path))
        .await
        .map_err(|e| AppError::Io(format!("tarea interna interrumpida: {e}")))??;
    send(session, &scripts::session_script(), &oauth).await
}

/// «Llave de acceso»: deja la llave en el servidor (ya normalizada con [`normalize_token`]).
pub async fn set_token(session: &SshSession, token: &Zeroizing<String>) -> AppResult<ClaudeVpsSent> {
    send(session, &scripts::token_script(), token.as_bytes()).await
}

async fn send(session: &SshSession, script: &str, secret: &[u8]) -> AppResult<ClaudeVpsSent> {
    let (command, stdin) = scripts::exec_request(script, secret);
    let result = exec::run_with_stdin(session, &command, &stdin, TIMEOUT_SECS).await?;
    drop(stdin);
    outcome(&result)
}

/// Traduce el resultado del script. El error solo lleva la primera línea de stderr y nunca una que
/// parezca un secreto (por si acaso: el script no los escribe).
fn outcome(r: &ExecResult) -> AppResult<ClaudeVpsSent> {
    if r.timed_out {
        return Err(AppError::Ssh("El servidor tardó demasiado en guardar la cuenta".into()));
    }
    if r.exit_code == Some(0) && r.stdout.lines().any(|l| l.trim() == "ok=1") {
        return Ok(ClaudeVpsSent { backup: r.stdout.lines().any(|l| l.trim() == scripts::BACKUP_MARK) });
    }
    if r.exit_code == Some(scripts::EXIT_EMPTY) {
        return Err(AppError::Ssh("La cuenta no llegó al servidor: vuelve a intentarlo".into()));
    }
    let detail = r
        .stderr
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !looks_secret(l))
        .unwrap_or("sin más detalle");
    Err(AppError::Ssh(format!("No se pudo guardar la cuenta en el servidor: {detail}")))
}

fn looks_secret(line: &str) -> bool {
    ["sk-ant-", "accessToken", "refreshToken", "claudeAiOauth"].iter().any(|w| line.contains(w))
}
