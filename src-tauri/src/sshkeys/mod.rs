//! Llaves PRIVADAS de ~/.ssh de este equipo: detectarlas para el formulario del servidor y
//! Ajustes → Llaves SSH. Solo se devuelve su ruta, su tipo y la parte pública: el secreto no sale
//! de aquí, más los `Host` de ~/.ssh/config que la usan. (Crear llaves y listar las `.pub` está en
//! `localkeys`.)

mod comment;
pub mod commands;
mod detect;
mod hosts;
#[cfg(test)]
mod tests;

use std::path::Path;

use serde::Serialize;

use crate::storage::ssh_config::{key_hosts::key_hosts, SshEnv};

pub use detect::{LocalPrivateKey, list_private_keys};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalKeys {
    /// Carpeta donde se buscó (~/.ssh).
    pub dir: String,
    pub keys: Vec<LocalPrivateKey>,
    /// Comentario sugerido para una llave nueva: `usuario@equipo`.
    pub default_comment: String,
}

/// Llaves privadas de `dir` (~/.ssh) y el comentario sugerido para crear una.
pub fn local_keys(dir: &Path) -> LocalKeys {
    let mut keys = list_private_keys(dir);
    // Sin ~/.ssh/config legible, las llaves se listan igual (sin sus `Host`).
    if let Ok(env) = SshEnv::user() {
        hosts::attach_config_hosts(&mut keys, &key_hosts(&env));
    }
    LocalKeys { keys, dir: dir.to_string_lossy().into_owned(), default_comment: comment::default_comment() }
}
