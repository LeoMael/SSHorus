//! Ruta fija del puente para cada usuario. La AppImage monta el programa en una carpeta distinta en cada
//! arranque (`/tmp/.mount_…`): la app copia ahí su `sshorus-mcp` y las configuraciones de los asistentes
//! apuntan a esta ruta, que no cambia.
//!
//! - Linux y macOS: `~/.local/bin/sshorus-mcp`.
//! - Windows: `%LOCALAPPDATA%\SSHorus\bin\sshorus-mcp.exe`.

use std::path::{Path, PathBuf};

pub fn file_name() -> String {
    format!("sshorus-mcp{}", std::env::consts::EXE_SUFFIX)
}

pub fn stable_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Some(dirs::data_local_dir()?.join("SSHorus").join("bin").join(file_name()))
    }
    #[cfg(not(windows))]
    {
        Some(dirs::home_dir()?.join(".local").join("bin").join(file_name()))
    }
}

/// La carpeta está en `PATH` (entonces basta con escribir `sshorus-mcp`).
pub fn dir_in_path(dir: &Path, path_var: Option<&std::ffi::OsStr>) -> bool {
    path_var.is_some_and(|p| std::env::split_paths(p).any(|d| d == dir))
}

/// Ruta que se escribe en la configuración de un asistente: la fija si existe; si no, este programa.
pub fn for_config() -> Option<PathBuf> {
    stable_path().filter(|p| p.is_file()).or_else(|| std::env::current_exe().ok())
}
