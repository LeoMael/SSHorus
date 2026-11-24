//! Archivos de este PC que el asistente no puede subir al servidor (`upload`): una vez allí podría leerlos
//! con `read_file`. Son las llaves privadas SSH (la carpeta `~/.ssh` salvo lo público, y la llave de cada
//! servidor guardado) y la carpeta de configuración de SSHorus (bóveda, ajustes). Tampoco una carpeta que
//! las contenga (p. ej. la carpeta personal entera).

use std::path::{Path, PathBuf};

/// Archivos de `~/.ssh` que sí se pueden subir (no son secretos).
fn is_public_ssh_file(name: &str) -> bool {
    name.ends_with(".pub") || name.starts_with("known_hosts") || name.starts_with("authorized_keys") || name == "config"
}

fn expand_tilde(p: &str, home: Option<&Path>) -> PathBuf {
    match (p.strip_prefix("~/"), home) {
        (Some(rest), Some(h)) => h.join(rest),
        _ if p == "~" => home.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(p)),
        _ => PathBuf::from(p),
    }
}

/// Ruta real (sigue enlaces) si existe; si no, tal cual.
fn real(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Lo protegido en este equipo: (carpetas enteras, archivos sueltos).
pub struct Protected {
    /// Carpetas cuyo contenido no se sube (la de SSHorus).
    pub dirs: Vec<PathBuf>,
    /// `~/.ssh`: no se sube salvo lo público.
    pub ssh_dir: Option<PathBuf>,
    /// Llaves privadas de los servidores guardados.
    pub files: Vec<PathBuf>,
}

impl Protected {
    /// Lo de este usuario. `key_paths`: la llave de cada servidor guardado.
    pub fn of_this_user(key_paths: &[String]) -> Self {
        let home = dirs::home_dir();
        Protected {
            dirs: crate::storage::fsutil::config_dir().into_iter().map(|d| real(&d)).collect(),
            ssh_dir: home.as_ref().map(|h| real(&h.join(".ssh"))),
            files: key_paths.iter().map(|k| real(&expand_tilde(k.trim(), home.as_deref()))).collect(),
        }
    }

    /// Por qué no se puede subir `path` (None = se puede).
    pub fn blocked(&self, path: &Path) -> Option<String> {
        let p = real(path);
        let inside_or_holds = |d: &Path| p.starts_with(d) || d.starts_with(&p);
        if self.dirs.iter().any(|d| inside_or_holds(d)) {
            return Some(format!("«{}» tiene la configuración de SSHorus (contraseñas cifradas)", path.display()));
        }
        if self.files.iter().any(|f| inside_or_holds(f)) {
            return Some(format!("«{}» es (o contiene) la llave privada de un servidor", path.display()));
        }
        if let Some(ssh) = &self.ssh_dir {
            let public = p.parent() == Some(ssh.as_path())
                && p.file_name().and_then(|n| n.to_str()).is_some_and(is_public_ssh_file);
            if inside_or_holds(ssh) && !public {
                return Some(format!("«{}» es (o contiene) la carpeta de llaves SSH (~/.ssh)", path.display()));
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> Protected {
        Protected {
            dirs: vec![PathBuf::from("/home/u/.config/sshorus")],
            ssh_dir: Some(PathBuf::from("/home/u/.ssh")),
            files: vec![PathBuf::from("/home/u/llaves/servidor")],
        }
    }

    #[test]
    fn llaves_y_configuracion_no() {
        let g = guard();
        for p in [
            "/home/u/.ssh/id_ed25519",
            "/home/u/.ssh",
            "/home/u",
            "/home/u/.config/sshorus/vault.json",
            "/home/u/.config",
            "/home/u/llaves/servidor",
            "/home/u/llaves",
        ] {
            assert!(g.blocked(Path::new(p)).is_some(), "{p}");
        }
    }

    #[test]
    fn lo_demas_si() {
        let g = guard();
        for p in ["/home/u/.ssh/id_ed25519.pub", "/home/u/.ssh/known_hosts", "/home/u/proyecto/app.tar", "/tmp/x"] {
            assert_eq!(g.blocked(Path::new(p)), None, "{p}");
        }
    }

    #[test]
    fn virgulilla() {
        let home = Path::new("/home/u");
        assert_eq!(expand_tilde("~/k", Some(home)), PathBuf::from("/home/u/k"));
        assert_eq!(expand_tilde("~", Some(home)), PathBuf::from("/home/u"));
        assert_eq!(expand_tilde("/abs", Some(home)), PathBuf::from("/abs"));
    }
}
