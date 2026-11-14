//! Los `Host` de `~/.ssh/config` que usan cada llave (para mostrar «GitHub» o «Usada en: …»).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::LocalPrivateKey;
use crate::storage::ssh_config::key_hosts::KeyHost;

/// `Host` de `~/.ssh/config` que usa una llave.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigHost {
    pub alias: String,
    /// `HostName` (o el alias si no lo tiene).
    pub hostname: String,
}

/// Misma ruta aunque una pase por un enlace simbólico.
fn real(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Rellena `config_hosts` de cada llave con los `Host` cuya `IdentityFile` es esa llave.
pub fn attach_config_hosts(keys: &mut [LocalPrivateKey], hosts: &[KeyHost]) {
    let hosts: Vec<(PathBuf, &KeyHost)> = hosts.iter().map(|h| (real(&h.identity), h)).collect();
    for k in keys {
        let path = real(Path::new(&k.path));
        k.config_hosts = hosts
            .iter()
            .filter(|(p, _)| *p == path)
            .map(|(_, h)| ConfigHost { alias: h.alias.clone(), hostname: h.hostname.clone() })
            .collect();
    }
}
