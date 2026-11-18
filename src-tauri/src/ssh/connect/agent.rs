//! Autenticación con el agente SSH (`SSH_AUTH_SOCK`, agente de OpenSSH para Windows o Pageant).

use std::time::Duration;

use russh::client::{AuthResult, Handle};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::PublicKey;

use super::auth::Step;
use crate::error::{AppError, AppResult};
use crate::ssh::handler::ClientHandler;

/// Cliente del agente SSH sobre el transporte que haya (socket Unix, tubería con nombre, Pageant).
type Agent = AgentClient<Box<dyn AgentStream + Send + Unpin>>;

/// Tiempo máximo para abrir cada agente y leer sus llaves.
const AGENT_TIMEOUT: Duration = Duration::from_secs(5);

/// Tubería del agente de OpenSSH para Windows (servicio «ssh-agent»).
#[cfg(windows)]
const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// Dónde buscar un agente SSH.
enum AgentSource {
    /// Socket Unix de `SSH_AUTH_SOCK`.
    #[cfg(unix)]
    Socket(String),
    /// Tubería con nombre de Windows (`SSH_AUTH_SOCK` o el agente de OpenSSH).
    #[cfg(windows)]
    Pipe(String),
    /// PuTTY Pageant (tubería moderna o, si no, mensajes de ventana).
    #[cfg(windows)]
    Pageant,
}

impl AgentSource {
    fn label(&self) -> String {
        match self {
            #[cfg(unix)]
            AgentSource::Socket(p) => format!("SSH_AUTH_SOCK ({p})"),
            #[cfg(windows)]
            AgentSource::Pipe(p) => format!("agente OpenSSH ({p})"),
            #[cfg(windows)]
            AgentSource::Pageant => "Pageant".into(),
        }
    }

    async fn connect(&self) -> Result<Agent, russh::keys::Error> {
        match self {
            #[cfg(unix)]
            AgentSource::Socket(p) => Ok(AgentClient::connect_uds(p).await?.dynamic()),
            #[cfg(windows)]
            AgentSource::Pipe(p) => Ok(AgentClient::connect_named_pipe(p).await?.dynamic()),
            #[cfg(windows)]
            AgentSource::Pageant => Ok(AgentClient::connect_pageant().await?.dynamic()),
        }
    }
}

fn auth_sock() -> Option<String> {
    std::env::var("SSH_AUTH_SOCK")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Agentes a probar, en orden.
/// - Unix: `SSH_AUTH_SOCK`.
/// - Windows: `SSH_AUTH_SOCK` si es una tubería (`\\.\pipe\…`), el agente de OpenSSH y Pageant.
fn agent_sources() -> Vec<AgentSource> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(unix)]
    if let Some(sock) = auth_sock() {
        out.push(AgentSource::Socket(sock));
    }
    #[cfg(windows)]
    {
        let sock = auth_sock();
        match &sock {
            Some(s) if s.starts_with(r"\\") => out.push(AgentSource::Pipe(s.clone())),
            // Git Bash/MSYS ponen aquí un socket de Cygwin, que no se puede abrir desde Windows.
            Some(s) => log::debug!("agente SSH: SSH_AUTH_SOCK={s} no es una tubería de Windows; se ignora"),
            None => {}
        }
        if !sock.is_some_and(|s| s.eq_ignore_ascii_case(OPENSSH_AGENT_PIPE)) {
            out.push(AgentSource::Pipe(OPENSSH_AGENT_PIPE.into()));
        }
        out.push(AgentSource::Pageant);
    }
    out
}

/// Abre el primer agente que responda y tenga llaves, y devuelve esas llaves.
async fn open_agent() -> AppResult<(Agent, Vec<AgentIdentity>)> {
    let sources = agent_sources();
    if sources.is_empty() {
        return Err(AppError::AuthFailed(
            "no hay un agente SSH disponible (SSH_AUTH_SOCK no está definido)".into(),
        ));
    }
    let mut found_empty = false;
    for source in sources {
        let attempt = async {
            let mut agent = source.connect().await?;
            let ids = agent.request_identities().await?;
            Ok::<_, russh::keys::Error>((agent, ids))
        };
        match tokio::time::timeout(AGENT_TIMEOUT, attempt).await {
            Ok(Ok((agent, ids))) if !ids.is_empty() => return Ok((agent, ids)),
            Ok(Ok(_)) => {
                log::debug!("agente SSH: {} no tiene llaves", source.label());
                found_empty = true;
            }
            Ok(Err(e)) => log::debug!("agente SSH: {}: {e}", source.label()),
            Err(_) => log::debug!("agente SSH: {} no respondió a tiempo", source.label()),
        }
    }
    if found_empty {
        return Err(AppError::AuthFailed(
            "el agente SSH no tiene llaves cargadas (usa ssh-add)".into(),
        ));
    }
    Err(AppError::AuthFailed(NO_AGENT_MSG.into()))
}

#[cfg(unix)]
const NO_AGENT_MSG: &str = "no hay un agente SSH disponible (SSH_AUTH_SOCK no está definido o no responde)";
#[cfg(windows)]
const NO_AGENT_MSG: &str = "no hay un agente SSH disponible: inicia el servicio «Agente de autenticación de \
OpenSSH» (ssh-agent) o Pageant y carga tu llave";
#[cfg(not(any(unix, windows)))]
const NO_AGENT_MSG: &str = "la autenticación con agente SSH no está soportada en este sistema";

pub(super) async fn auth_agent(handle: &mut Handle<ClientHandler>, user: &str) -> AppResult<Step> {
    let (mut agent, identities) = open_agent().await?;
    if let Some(binding) = handle.agent_session_binding() {
        // Opcional: algunos agentes no soportan session-bind; no es fatal.
        if let Err(e) = agent.bind_session(binding, false).await {
            log::debug!("agente SSH: session-bind no soportado: {e}");
        }
    }
    let hash = handle.best_supported_rsa_hash().await?.flatten();
    for id in identities {
        let res = match &id {
            AgentIdentity::PublicKey { key, .. } => {
                let key: PublicKey = key.clone();
                handle
                    .authenticate_publickey_with(user, key, hash, &mut agent)
                    .await
            }
            AgentIdentity::Certificate { certificate, .. } => {
                handle
                    .authenticate_certificate_with(user, certificate.clone(), hash, &mut agent)
                    .await
            }
        };
        match res {
            Ok(AuthResult::Success) => return Ok(Step::Done),
            Ok(AuthResult::Failure {
                partial_success: true,
                remaining_methods,
            }) => return Ok(Step::Partial(remaining_methods)),
            Ok(AuthResult::Failure { .. }) => continue,
            Err(e) => {
                log::debug!("agente SSH: firma fallida: {e}");
                if handle.is_closed() {
                    return Err(AppError::Network("El servidor cerró la conexión".into()));
                }
                continue;
            }
        }
    }
    Err(AppError::AuthFailed(
        "el servidor rechazó todas las llaves del agente SSH".into(),
    ))
}
