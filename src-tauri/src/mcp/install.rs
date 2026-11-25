//! Puente en una ruta fija (`bridge::paths::stable_path`): al arrancar, la app copia su `sshorus-mcp` ahí si
//! falta o es más viejo. Así las configuraciones de los asistentes no se rompen cuando la AppImage cambia de
//! carpeta en cada arranque, y `sshorus-mcp pair` funciona desde cualquier terminal. Sin sudo: es una carpeta
//! del usuario. La copia es atómica (temporal + rename) para que un asistente nunca arranque un archivo a medias.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use super::bridge::paths;
use crate::storage::fsutil;

/// El puente que viene con esta app (junto al programa).
pub fn bundled_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.with_file_name(paths::file_name()))
}

/// La ruta que se usa en las configuraciones: la fija si existe; si no, la del paquete. (ruta, es la fija)
pub fn preferred_path() -> Option<(PathBuf, bool)> {
    match paths::stable_path().filter(|p| p.is_file()) {
        Some(p) => Some((p, true)),
        None => bundled_path().map(|p| (p, false)),
    }
}

/// ¿`a` es una versión más nueva que `b`? («1.0.0» > «1.0.0-beta.3» > «1.0.0-beta.2»).
pub fn is_newer(a: &str, b: &str) -> bool {
    version_key(a) > version_key(b)
}

/// Clave ordenable: números del núcleo, luego «sin pre-versión» gana a cualquier pre-versión.
fn version_key(v: &str) -> (Vec<u64>, bool, Vec<(u64, String)>) {
    let v = v.trim().trim_start_matches('v');
    let (core, pre) = v.split_once('-').map_or((v, None), |(c, p)| (c, Some(p)));
    let nums = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
    let pre_parts = pre
        .map(|p| p.split('.').map(|x| x.parse().map_or((u64::MAX, x.to_string()), |n| (n, String::new()))).collect())
        .unwrap_or_default();
    (nums, pre.is_none(), pre_parts)
}

/// «sshorus-mcp 1.0.0-beta.3» → «1.0.0-beta.3».
pub fn parse_version_output(out: &str) -> Option<String> {
    out.trim().strip_prefix("sshorus-mcp ").map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn version_of(path: &Path) -> Option<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // Por si un archivo raro no termina: se espera un rato y se corta.
    for _ in 0..30 {
        if child.try_wait().ok()?.is_some() {
            let out = child.wait_with_output().ok()?;
            return parse_version_output(&String::from_utf8_lossy(&out.stdout));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    None
}

/// Qué pasó al poner el puente en su sitio.
#[derive(Debug, PartialEq, Eq)]
pub enum Installed {
    Copied,
    UpToDate,
    /// Allí hay uno más nuevo (de otra instalación): no se toca.
    KeptNewer(String),
}

/// Copia `src` a `dst` si falta, es distinto y no es más nuevo que `version`.
pub fn install(src: &Path, dst: &Path, version: &str) -> std::io::Result<Installed> {
    let new = std::fs::read(src)?;
    if std::fs::read(dst).is_ok_and(|old| old == new) {
        return Ok(Installed::UpToDate);
    }
    if dst.is_file()
        && let Some(theirs) = version_of(dst)
        && is_newer(&theirs, version)
    {
        return Ok(Installed::KeptNewer(theirs));
    }
    let dir = dst.parent().ok_or_else(|| std::io::Error::other("ruta sin carpeta"))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{}.tmp-{}", paths::file_name(), std::process::id()));
    let result = (|| {
        std::fs::write(&tmp, &new)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        }
        fsutil::replace_file(&tmp, dst)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.map(|()| Installed::Copied)
}

/// Al arrancar, en segundo plano (lee unos MB del disco).
pub fn install_in_background() {
    let (Some(src), Some(dst)) = (bundled_path().filter(|p| p.is_file()), paths::stable_path()) else { return };
    tauri::async_runtime::spawn_blocking(move || match install(&src, &dst, env!("CARGO_PKG_VERSION")) {
        Ok(Installed::Copied) => log::info!("MCP: puente copiado a {}", dst.display()),
        Ok(Installed::UpToDate) => {}
        Ok(Installed::KeptNewer(v)) => log::info!("MCP: en {} hay un puente más nuevo ({v}); se deja", dst.display()),
        // Windows no deja reemplazar un .exe en uso (un asistente abierto): se intentará en el próximo arranque.
        Err(e) => log::warn!("MCP: no se pudo copiar el puente a {}: {e}", dst.display()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_like_releases() {
        assert!(is_newer("1.0.0", "1.0.0-beta.3"));
        assert!(is_newer("1.0.0-beta.10", "1.0.0-beta.3"));
        assert!(is_newer("1.0.0-rc.1", "1.0.0-beta.9"));
        assert!(!is_newer("1.2.0", "1.10.0-beta.1"));
        assert!(!is_newer("1.0.0-beta.3", "1.0.0-beta.3"));
        assert_eq!(parse_version_output("sshorus-mcp 1.0.0-beta.3\n").as_deref(), Some("1.0.0-beta.3"));
        assert_eq!(parse_version_output("otra cosa"), None);
    }

    #[test]
    fn install_copies_once_and_atomically() {
        let dir = std::env::temp_dir().join(format!("sshorus-install-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("origen");
        let dst = dir.join("bin").join(paths::file_name());
        std::fs::write(&src, b"puente v1").unwrap();
        assert_eq!(install(&src, &dst, "1.0.0").unwrap(), Installed::Copied);
        assert_eq!(std::fs::read(&dst).unwrap(), b"puente v1");
        assert_eq!(install(&src, &dst, "1.0.0").unwrap(), Installed::UpToDate);
        // Otro contenido (y el viejo no dice su versión): se reemplaza.
        std::fs::write(&src, b"puente v2").unwrap();
        assert_eq!(install(&src, &dst, "1.0.1").unwrap(), Installed::Copied);
        assert_eq!(std::fs::read(&dst).unwrap(), b"puente v2");
        // Sin temporales sueltos.
        assert_eq!(std::fs::read_dir(dst.parent().unwrap()).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&dst).unwrap().permissions().mode() & 0o777, 0o755);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
