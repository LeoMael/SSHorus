//! Exportar: escribe los servidores en el bloque marcado de SSHorus dentro de `~/.ssh/config`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::alias::{assign_aliases_with, load_overrides};
#[cfg(test)]
use super::alias::assign_aliases;
use super::parse::split_line;
use super::{fsutil, SshEnv, BEGIN_MARKER, END_MARKER};
use crate::error::{AppError, AppResult};
use crate::types::{AuthMethod, ServerProfile, SshConfigExport};

/// Serializa exportaciones simultáneas (p. ej. dos guardados seguidos con sincronización activa).
static EXPORT_LOCK: Mutex<()> = Mutex::new(());

/// Exporta `servers` al bloque de SSHorus.
#[cfg(test)]
pub fn export(env: &SshEnv, servers: &[ServerProfile]) -> AppResult<SshConfigExport> {
    export_with(env, || servers.to_vec())
}

/// Igual que [`export`], pero lee los servidores ya dentro del candado: la última exportación
/// siempre escribe el estado más reciente.
pub fn export_with(env: &SshEnv, servers: impl FnOnce() -> Vec<ServerProfile>) -> AppResult<SshConfigExport> {
    let _guard = EXPORT_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let servers = servers();
    let target = resolve_symlink(&env.config);
    let original = match fs::read(&target) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(AppError::Io(format!("no se pudo leer {}: {e}", env.config.display()))),
    };
    let aliases = assign_aliases_with(&servers, &load_overrides(env));
    let next = splice_aliased(&original, &servers, &aliases)?;
    let out = SshConfigExport { path: env.config.display().to_string(), count: servers.len() };
    if next == original {
        return Ok(out);
    }
    if !env.ssh_dir.exists() {
        fsutil::ensure_private_dir(&env.ssh_dir)?;
    }
    if let Some(dir) = target.parent().filter(|d| !d.exists()) {
        fsutil::ensure_private_dir(dir)?;
    }
    // Copia de seguridad única, antes de la primera escritura.
    if !original.is_empty() && !env.backup.exists() {
        fsutil::write_atomic(&env.backup, &original)?;
    }
    fsutil::write_atomic(&target, &next)?;
    Ok(out)
}

/// Si `~/.ssh/config` es un enlace simbólico (dotfiles), escribimos en el destino y no lo rompemos.
fn resolve_symlink(p: &Path) -> PathBuf {
    match fs::symlink_metadata(p) {
        Ok(m) if m.file_type().is_symlink() => fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()),
        _ => p.to_path_buf(),
    }
}

/// Devuelve el contenido nuevo: el original con el bloque de SSHorus reemplazado/insertado
/// (o quitado si no hay servidores). Todo lo de fuera del bloque se conserva byte a byte.
#[cfg(test)]
pub fn splice_block(original: &[u8], servers: &[ServerProfile]) -> AppResult<Vec<u8>> {
    splice_aliased(original, servers, &assign_aliases(servers))
}

/// Igual que [`splice_block`] con los alias ya decididos (uno por servidor, mismo orden).
fn splice_aliased(original: &[u8], servers: &[ServerProfile], aliases: &[String]) -> AppResult<Vec<u8>> {
    let lines = split_lines(original);
    let begin = lines.iter().position(|&(s, e)| line_trim(&original[s..e]) == BEGIN_MARKER.as_bytes());

    if let Some(b) = begin {
        let end = lines[b + 1..]
            .iter()
            .position(|&(s, e)| line_trim(&original[s..e]) == END_MARKER.as_bytes())
            .map(|i| b + 1 + i)
            .ok_or_else(|| {
                AppError::Invalid(format!(
                    "El bloque de SSHorus en ~/.ssh/config está incompleto (falta «{END_MARKER}»). Corrígelo a mano."
                ))
            })?;
        let prefix = &original[..lines[b].0];
        let mut suffix = &original[lines[end].1..];
        let mut out = prefix.to_vec();
        if servers.is_empty() {
            // Quitar el bloque y la línea en blanco que lo separaba.
            if prefix.is_empty() || prefix.ends_with(b"\n\n") {
                suffix = suffix.strip_prefix(b"\r\n").or_else(|| suffix.strip_prefix(b"\n")).unwrap_or(suffix);
            }
        } else {
            // Si tras el bloque hay opciones sueltas (no Host/Match), cerramos con `Host *`
            // para que sigan aplicando a todos como antes.
            let reset = !next_is_section_or_eof(suffix);
            out.extend_from_slice(render_aliased(servers, aliases, reset).as_bytes());
        }
        out.extend_from_slice(suffix);
        return Ok(out);
    }

    if servers.is_empty() {
        return Ok(original.to_vec());
    }
    let block = render_aliased(servers, aliases, false);
    let first_section = lines.iter().find(|&&(s, e)| is_section_line(&original[s..e])).map(|&(s, _)| s);
    let mut out = Vec::with_capacity(original.len() + block.len() + 2);
    match first_section {
        Some(at) => {
            let prefix = &original[..at];
            out.extend_from_slice(prefix);
            if !prefix.is_empty() && !ends_with_blank_line(prefix) {
                out.push(b'\n');
            }
            out.extend_from_slice(block.as_bytes());
            out.push(b'\n');
            out.extend_from_slice(&original[at..]);
        }
        None => {
            out.extend_from_slice(original);
            if !original.is_empty() {
                if !original.ends_with(b"\n") {
                    out.push(b'\n');
                }
                if !ends_with_blank_line(&out) {
                    out.push(b'\n');
                }
            }
            out.extend_from_slice(block.as_bytes());
        }
    }
    Ok(out)
}

/// Bloque completo (con marcadores), terminado en `\n`.
fn render_aliased(servers: &[ServerProfile], aliases: &[String], reset: bool) -> String {
    let mut s = String::new();
    s.push_str(BEGIN_MARKER);
    s.push('\n');
    for (i, (srv, alias)) in servers.iter().zip(aliases).enumerate() {
        if i > 0 {
            s.push('\n');
        }
        s.push_str(&format!("Host {alias}\n"));
        s.push_str(&format!("    HostName {}\n", cfg_value(&srv.host)));
        if srv.port != 22 {
            s.push_str(&format!("    Port {}\n", srv.port));
        }
        s.push_str(&format!("    User {}\n", cfg_value(&srv.username)));
        let key = srv.key_path.as_deref().map(str::trim).filter(|k| !k.is_empty());
        if let (AuthMethod::Key, Some(k)) = (srv.auth, key) {
            s.push_str(&format!("    IdentityFile {}\n", cfg_value(&identity_path(k))));
        }
    }
    if reset {
        s.push_str("\n# Lo que sigue vuelve a aplicarse a todos los hosts\nHost *\n");
    }
    s.push_str(END_MARKER);
    s.push('\n');
    s
}

/// Ruta de llave para `IdentityFile`. En Windows se escribe con `/`: OpenSSH trata la barra
/// invertida como escape en algunos casos (`\\servidor` se rompería) y acepta `/` como separador.
fn identity_path(k: &str) -> String {
    if cfg!(windows) { k.replace('\\', "/") } else { k.to_string() }
}

/// Valor seguro para una línea de ssh_config: sin saltos ni comillas; entre comillas si tiene espacios.
fn cfg_value(v: &str) -> String {
    let clean: String = v.chars().filter(|c| !c.is_control() && *c != '"').collect();
    if clean.chars().any(char::is_whitespace) || clean.starts_with('#') {
        format!("\"{clean}\"")
    } else {
        clean
    }
}

/// (inicio, fin) de cada línea, con su `\n` incluido.
fn split_lines(b: &[u8]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, &c) in b.iter().enumerate() {
        if c == b'\n' {
            out.push((start, i + 1));
            start = i + 1;
        }
    }
    if start < b.len() {
        out.push((start, b.len()));
    }
    out
}

fn line_trim(l: &[u8]) -> &[u8] {
    l.trim_ascii()
}

fn line_keyword(l: &[u8]) -> Option<String> {
    let t = String::from_utf8_lossy(l);
    split_line(&t).map(|(k, _)| k)
}

fn is_section_line(l: &[u8]) -> bool {
    matches!(line_keyword(l).as_deref(), Some("host" | "match"))
}

fn next_is_section_or_eof(rest: &[u8]) -> bool {
    for (s, e) in split_lines(rest) {
        if let Some(k) = line_keyword(&rest[s..e]) {
            return k == "host" || k == "match";
        }
    }
    true
}

fn ends_with_blank_line(b: &[u8]) -> bool {
    b.ends_with(b"\n\n") || b.ends_with(b"\n\r\n")
}
