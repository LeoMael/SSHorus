//! Qué `Host` de `~/.ssh/config` nombran cada llave con `IdentityFile`: sirve para decir en la
//! interfaz para qué se usa una llave (GitHub, servidores…). Solo se leen nombres y rutas.

use std::fs;
use std::path::PathBuf;

use super::{cond_matches, expand_tilde, expand_tokens, Cond, Parser, SshEnv};

/// Un `Host` concreto del usuario y una llave que usa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyHost {
    pub alias: String,
    /// `HostName` (o el alias si no lo tiene).
    pub hostname: String,
    pub identity: PathBuf,
}

/// Pares `Host` → llave de la configuración del usuario (sin el bloque de SSHorus, que ya se
/// conoce por los servidores guardados). Un `Host` puede tener varias `IdentityFile`.
pub fn key_hosts(env: &SshEnv) -> Vec<KeyHost> {
    let Ok(bytes) = fs::read(&env.config) else { return Vec::new() };
    let mut parser = Parser { env, sections: Vec::new(), aliases: Vec::new() };
    parser.parse_text(&String::from_utf8_lossy(&bytes), 0, Cond::All);

    let mut out = Vec::new();
    for alias in &parser.aliases {
        let mut hostname: Option<&str> = None;
        let mut identities: Vec<PathBuf> = Vec::new();
        for s in parser.sections.iter().filter(|s| cond_matches(&s.cond, alias)) {
            for (k, args) in &s.opts {
                let Some(first) = args.first() else { continue };
                match k.as_str() {
                    "hostname" if hostname.is_none() => hostname = Some(first),
                    // A diferencia de las demás opciones, todas las `IdentityFile` se suman.
                    "identityfile" if !first.eq_ignore_ascii_case("none") => {
                        let p = identity_path(env, &expand_tokens(env, first, alias));
                        if !identities.contains(&p) {
                            identities.push(p);
                        }
                    }
                    _ => {}
                }
            }
        }
        let hostname = hostname.map(|h| expand_tokens(env, h, alias)).unwrap_or_else(|| alias.clone());
        out.extend(identities.into_iter().map(|identity| KeyHost {
            alias: alias.clone(),
            hostname: hostname.clone(),
            identity,
        }));
    }
    out
}

/// `~/…` → carpeta personal; una ruta relativa se toma desde `~/.ssh`, donde suelen estar.
fn identity_path(env: &SshEnv, p: &str) -> PathBuf {
    let p = expand_tilde(env, p);
    if p.is_absolute() { p } else { env.ssh_dir.join(p) }
}

#[cfg(test)]
mod tests {
    use super::super::{BEGIN_MARKER, END_MARKER};
    use super::*;

    #[test]
    fn hosts_with_their_keys() {
        let home = std::env::temp_dir().join(format!("sshorus-keyhosts-{}", uuid::Uuid::new_v4()));
        let env = SshEnv::for_home(&home, "yo");
        fs::create_dir_all(&env.ssh_dir).unwrap();
        let text = format!(
            "Host github.com\n  IdentityFile ~/.ssh/id_github\n\
             Host gh-trabajo\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/trabajo\n\
             Host tesis\n  HostName 10.0.0.5\n  IdentityFile id_tesis\n  IdentityFile ~/.ssh/trabajo\n\
             Host sin-llave\n  HostName x.lan\n\
             Host nada\n  IdentityFile none\n\
             {BEGIN_MARKER}\nHost sshorus-web\n    IdentityFile ~/.ssh/ignorada\n{END_MARKER}\n"
        );
        fs::write(&env.config, text).unwrap();
        let kh = |a: &str, h: &str, k: &str| KeyHost {
            alias: a.into(),
            hostname: h.into(),
            identity: env.ssh_dir.join(k),
        };
        assert_eq!(
            key_hosts(&env),
            [
                kh("github.com", "github.com", "id_github"),
                kh("gh-trabajo", "github.com", "trabajo"),
                kh("tesis", "10.0.0.5", "id_tesis"),
                kh("tesis", "10.0.0.5", "trabajo"),
            ]
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn no_config() {
        assert!(key_hosts(&SshEnv::for_home("/no/existe/sshorus", "yo")).is_empty());
    }
}
