//! Importar: servidores candidatos a partir de los `Host` concretos de `~/.ssh/config`.

use std::collections::HashSet;
use std::fs;

use serde::Serialize;

use super::alias::{assign_aliases_with, load_overrides};
use super::parse::{cond_matches, expand_tokens, tildeify, Cond, Parser};
use super::SshEnv;
use crate::error::{AppError, AppResult};
use crate::types::{AuthMethod, ServerProfile};

/// Llaves que ssh prueba por defecto si no hay `IdentityFile`.
const DEFAULT_KEYS: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

fn same_key(host: &str, port: u16, user: &str) -> (String, u16, String) {
    (host.to_lowercase(), port, user.to_string())
}

/// Lee la configuración de ssh y devuelve servidores candidatos (id ""), omitiendo los que ya
/// existen en `existing` (mismo host + puerto + usuario) y el propio bloque de SSHorus.
pub fn import(env: &SshEnv, existing: &[ServerProfile]) -> AppResult<Vec<ServerProfile>> {
    Ok(import_preview(env, existing)?
        .into_iter()
        .filter(|c| c.existing_id.is_none())
        .map(|c| c.server)
        .collect())
}

/// Candidato a importar, marcado si ya está en SSHorus.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshImportCandidate {
    pub server: ServerProfile,
    /// Servidor de SSHorus con el mismo host + puerto + usuario.
    pub existing_id: Option<String>,
    pub existing_name: Option<String>,
    /// Nombre del servidor de SSHorus que se exporta con este mismo alias (choque de `Host`).
    pub alias_used_by: Option<String>,
}

/// Como [`import`], pero devuelve también los que ya existen (marcados) en lugar de omitirlos.
pub fn import_preview(env: &SshEnv, existing: &[ServerProfile]) -> AppResult<Vec<SshImportCandidate>> {
    let bytes = match fs::read(&env.config) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AppError::Io(format!("no se pudo leer {}: {e}", env.config.display()))),
    };
    let mut parser = Parser { env, sections: Vec::new(), aliases: Vec::new() };
    parser.parse_text(&String::from_utf8_lossy(&bytes), 0, Cond::All);

    let mut seen: HashSet<(String, u16, String)> = HashSet::new();
    let sshorus_aliases = assign_aliases_with(existing, &load_overrides(env));
    let mut out = Vec::new();

    for alias in &parser.aliases {
        let (mut hostname, mut port, mut user, mut identity): (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = (None, None, None, None);
        for s in parser.sections.iter().filter(|s| cond_matches(&s.cond, alias)) {
            for (k, args) in &s.opts {
                let Some(first) = args.first() else { continue };
                let slot = match k.as_str() {
                    "hostname" => &mut hostname,
                    "port" => &mut port,
                    "user" => &mut user,
                    "identityfile" => &mut identity,
                    _ => continue,
                };
                if slot.is_none() {
                    *slot = Some(first.clone());
                }
            }
        }

        let host = hostname.map(|h| expand_tokens(env, &h, alias)).unwrap_or_else(|| alias.clone());
        let port = match port {
            None => 22,
            Some(p) => match p.parse::<u16>() {
                Ok(p) if p > 0 => p,
                _ => {
                    log::warn!("~/.ssh/config: puerto inválido «{p}» en Host {alias}; se omite");
                    continue;
                }
            },
        };
        let username = user.unwrap_or_else(|| env.local_user.clone());
        let key_path = identity
            .filter(|i| !i.eq_ignore_ascii_case("none"))
            .map(|i| expand_tokens(env, &i, alias))
            .or_else(|| {
                DEFAULT_KEYS
                    .iter()
                    .map(|k| env.ssh_dir.join(k))
                    .find(|p| p.is_file())
                    .map(|p| tildeify(env, &p))
            });
        let auth = if key_path.is_some() { AuthMethod::Key } else { AuthMethod::Password };

        let candidate = ServerProfile {
            id: String::new(),
            name: alias.clone(),
            host,
            port,
            username,
            auth,
            key_path,
            default_path: None,
            color: None,
            tmux: None,
            sudo_mode: Default::default(),
        };
        let Ok(candidate) = crate::storage::validate_server(candidate) else { continue };
        let key = same_key(&candidate.host, candidate.port, &candidate.username);
        if !seen.insert(key.clone()) {
            continue; // otro Host del archivo ya apunta al mismo sitio
        }
        let same = existing.iter().find(|s| same_key(&s.host, s.port, &s.username) == key);
        let alias_used_by = sshorus_aliases
            .iter()
            .position(|a| a.eq_ignore_ascii_case(alias))
            .map(|i| existing[i].name.clone());
        out.push(SshImportCandidate {
            existing_id: same.map(|s| s.id.clone()),
            existing_name: same.map(|s| s.name.clone()),
            alias_used_by,
            server: candidate,
        });
    }
    Ok(out)
}
