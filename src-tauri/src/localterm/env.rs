//! Entorno de los procesos de la terminal local: dónde buscar programas, la shell del sistema y
//! un `PATH` completo sin restos del lanzador de la app.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use super::aicli::{self, Os, SearchEnv};
use super::args::{PORT_ENV, TOKEN_ENV};
use crate::error::{AppError, AppResult};

/// Carpetas `bin` de nvm, la versión más nueva primero.
fn nvm_bins(home: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(home.join(".nvm").join("versions").join("node")) else { return Vec::new() };
    let mut v: Vec<(Vec<u64>, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ver: Vec<u64> = name.trim_start_matches('v').split('.').filter_map(|p| p.parse().ok()).collect();
            (!ver.is_empty()).then(|| (ver, e.path().join("bin")))
        })
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|(_, p)| p).collect()
}

pub fn search_env() -> SearchEnv {
    let home = dirs::home_dir();
    SearchEnv {
        os: Os::current(),
        path: std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default(),
        nvm_bins: home.as_deref().map(nvm_bins).unwrap_or_default(),
        appdata: std::env::var_os("APPDATA").map(PathBuf::from),
        local_appdata: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        home,
    }
}

pub fn is_file(p: &Path) -> bool {
    p.is_file()
}

pub fn is_dir(p: &Path) -> bool {
    p.is_dir()
}

/// Shell del sistema (programa y argumentos).
pub fn shell_command(env: &SearchEnv) -> (PathBuf, Vec<String>) {
    let pwsh = if env.os == Os::Windows { aicli::find_program(env, "pwsh", &is_file) } else { None };
    let shell_var = std::env::var("SHELL").ok();
    aicli::default_shell(env.os, shell_var.as_deref(), pwsh, &is_file)
}

/// Variables que pone el lanzador de AppImage para la propia app: en una shell del usuario
/// romperían programas del sistema (bibliotecas de la app en lugar de las suyas).
const APPIMAGE_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GTK_THEME",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_BACKEND",
    "GIO_MODULE_DIR",
    "GI_TYPELIB_PATH",
    "GSETTINGS_SCHEMA_DIR",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
];

/// Comando base con el entorno de una terminal: tipo de terminal, `PATH` completo y sin restos
/// del lanzador de la app.
pub fn base_command(program: &Path, env: &SearchEnv, extra_path: &[PathBuf], cwd: &Path) -> AppResult<CommandBuilder> {
    let mut cmd = CommandBuilder::new(program);
    cmd.cwd(cwd);
    let mut path = aicli::augmented_path(env, extra_path, &is_dir);
    if let Some(appdir) = std::env::var_os("APPDIR").filter(|_| std::env::var_os("APPIMAGE").is_some()) {
        let appdir = PathBuf::from(appdir);
        path.retain(|d| !d.starts_with(&appdir));
        for k in APPIMAGE_VARS {
            cmd.env_remove(k);
        }
    }
    // Lo que puso SSHorus para su propia ventana (Linux + NVIDIA).
    cmd.env_remove("WEBKIT_DISABLE_DMABUF_RENDERER");
    let joined: OsString =
        std::env::join_paths(&path).map_err(|e| AppError::Invalid(format!("PATH no válido: {e}")))?;
    cmd.env("PATH", joined);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "SSHorus");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    // El token solo lo recibe un asistente lanzado con el MCP.
    cmd.env_remove(TOKEN_ENV);
    cmd.env_remove(PORT_ENV);
    Ok(cmd)
}

/// Carpeta de trabajo: la pedida si existe; si no, la carpeta personal.
pub fn resolve_cwd(cwd: Option<&str>) -> AppResult<PathBuf> {
    if let Some(c) = cwd.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        if p.is_dir() {
            return Ok(p);
        }
        return Err(AppError::NotFound(format!("la carpeta {c} no existe")));
    }
    dirs::home_dir().ok_or_else(|| AppError::Io("no se encontró la carpeta personal del usuario".into()))
}

