//! Exportar / importar servidores a `~/.ssh/config`.
//!
//! - **Exportar**: SSHorus escribe SOLO dentro de un bloque marcado
//!   (`# >>> SSHorus (no editar a mano) >>>` … `# <<< SSHorus <<<`). El resto del archivo se conserva
//!   byte a byte. La primera vez se guarda una copia en `~/.ssh/config.bak-sshorus`.
//!   Un bloque nuevo se inserta antes del primer `Host`/`Match` del usuario (así un `Host *` posterior
//!   no pisa nuestros valores y las opciones globales del principio siguen siendo globales).
//! - **Importar**: lee los `Host` concretos (con `Include`), resuelve sus opciones como OpenSSH
//!   (gana el primer valor; también aplican `Host *`, comodines y opciones globales) y devuelve candidatos.
//!
//! Las rutas se inyectan con [`SshEnv`] para poder probarlo con archivos temporales.

use std::path::PathBuf;

use super::fsutil;
use crate::error::{AppError, AppResult};

mod alias;
pub mod commands;
mod conflicts;
mod export;
mod import;
pub mod key_hosts;
mod parse;
mod scan;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod conflicts_tests;

pub use alias::{assign_aliases_with, load_overrides, AliasOverrides};
pub use export::export_with;
pub use import::import;
pub use parse::split_line;
// `key_hosts` reutiliza el lector de `parse`.
use parse::{cond_matches, expand_tilde, expand_tokens, Cond, Parser};

pub const BEGIN_MARKER: &str = "# >>> SSHorus (no editar a mano) >>>";
pub const END_MARKER: &str = "# <<< SSHorus <<<";

/// Igual que OpenSSH (READCONF_MAX_DEPTH).
const MAX_INCLUDE_DEPTH: usize = 16;

/// Rutas y datos del entorno (inyectables para tests).
#[derive(Debug, Clone)]
pub struct SshEnv {
    pub home: PathBuf,
    pub ssh_dir: PathBuf,
    pub config: PathBuf,
    pub backup: PathBuf,
    /// Usuario local: el que usa ssh si el `Host` no dice `User`.
    pub local_user: String,
    /// Alias elegidos a mano (id del servidor → alias). None = no se guardan.
    pub aliases_file: Option<PathBuf>,
}

impl SshEnv {
    pub fn for_home(home: impl Into<PathBuf>, local_user: impl Into<String>) -> Self {
        let home = home.into();
        let ssh_dir = home.join(".ssh");
        SshEnv {
            config: ssh_dir.join("config"),
            backup: ssh_dir.join("config.bak-sshorus"),
            aliases_file: Some(home.join(".config").join("sshorus").join("ssh-aliases.json")),
            ssh_dir,
            home,
            local_user: local_user.into(),
        }
    }

    /// Entorno real del usuario (`~/.ssh/config`).
    pub fn user() -> AppResult<Self> {
        let home =
            dirs::home_dir().ok_or_else(|| AppError::Io("no se encontró la carpeta personal del usuario".into()))?;
        let user = ["USER", "LOGNAME", "USERNAME"]
            .iter()
            .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))
            .unwrap_or_else(|| "root".into());
        let mut env = Self::for_home(home, user);
        env.aliases_file = fsutil::config_dir().map(|d| d.join("ssh-aliases.json"));
        Ok(env)
    }
}
