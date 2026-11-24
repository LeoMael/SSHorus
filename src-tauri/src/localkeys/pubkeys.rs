//! Lectura de llaves PÚBLICAS de la PC (`*.pub`). Nunca lee otra cosa: rechaza cualquier archivo
//! que no termine en `.pub`, que sea grande o que contenga una llave privada.
//! Una sola implementación para el asistente «Nuevo usuario con clave» (`local_ssh_public_keys`) y para
//! GitHub (`gh_local_pubkeys`, `gh_read_pubkey` y la validación de las llaves que se suben).

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Máximo de `*.pub` que se listan y tamaño máximo de cada uno.
const MAX_FILES: usize = 64;
const MAX_PUB_BYTES: u64 = 16 * 1024;

/// Tipos de llave pública OpenSSH aceptados.
const KEY_TYPES: &[&str] = &[
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "sk-ssh-ed25519@openssh.com",
    "sk-ecdsa-sha2-nistp256@openssh.com",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPublicKey {
    /// Ruta del `.pub`.
    pub path: String,
    /// Ruta de la privada (el `.pub` sin extensión) si existe.
    pub private_path: Option<String>,
    /// Línea normalizada `tipo base64 [comentario]`.
    pub line: String,
    pub key_type: String,
    pub comment: String,
}

fn has_pub_ext(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pub"))
}

/// Valida una línea de llave pública OpenSSH y la normaliza (`tipo base64 comentario`).
/// No admite opciones de `authorized_keys` delante.
pub fn parse_public_key_line(text: &str) -> AppResult<(String, String, String)> {
    let bad = || {
        AppError::Invalid("no parece una llave pública SSH (ssh-ed25519, ssh-rsa, ecdsa…)".into())
    };
    if text.contains("PRIVATE KEY") {
        return Err(AppError::Invalid(
            "eso es una llave PRIVADA: nunca la compartas".into(),
        ));
    }
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .ok_or_else(bad)?;
    let mut parts = line.split_whitespace();
    let ty = parts.next().ok_or_else(bad)?;
    let body = parts.next().ok_or_else(bad)?;
    let comment = parts.collect::<Vec<_>>().join(" ");
    if !KEY_TYPES.contains(&ty) {
        return Err(bad());
    }
    let b64_ok = body.len() >= 16
        && body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='));
    if !b64_ok {
        return Err(bad());
    }
    let norm = if comment.is_empty() {
        format!("{ty} {body}")
    } else {
        format!("{ty} {body} {comment}")
    };
    Ok((norm, ty.to_string(), comment))
}

/// Lee una llave pública de la PC. Solo archivos `.pub` (también tras resolver enlaces).
pub fn read_pub(path: &Path) -> AppResult<LocalPublicKey> {
    if !has_pub_ext(path) {
        return Err(AppError::Invalid(
            "solo se pueden leer llaves públicas (archivos .pub)".into(),
        ));
    }
    let real = fs::canonicalize(path)
        .map_err(|e| AppError::Io(format!("no se pudo abrir {}: {e}", path.display())))?;
    if !has_pub_ext(&real) {
        return Err(AppError::Invalid(
            "solo se pueden leer llaves públicas (archivos .pub)".into(),
        ));
    }
    let meta = fs::metadata(&real)?;
    if !meta.is_file() {
        return Err(AppError::Invalid("no es un archivo".into()));
    }
    if meta.len() > MAX_PUB_BYTES {
        return Err(AppError::Invalid(
            "el archivo es demasiado grande para ser una llave pública".into(),
        ));
    }
    let bytes = fs::read(&real)?;
    let text =
        String::from_utf8(bytes).map_err(|_| AppError::Invalid("el archivo no es texto".into()))?;
    let (line, key_type, comment) = parse_public_key_line(&text)?;
    let private = path.with_extension("");
    Ok(LocalPublicKey {
        path: path.display().to_string(),
        private_path: private
            .is_file()
            .then(|| private.to_string_lossy().into_owned()),
        line,
        key_type,
        comment,
    })
}

/// Llaves `*.pub` válidas de una carpeta, ordenadas por ruta (las inválidas se omiten).
pub fn list_public_keys(dir: &Path) -> Vec<LocalPublicKey> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<LocalPublicKey> = rd
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| has_pub_ext(p))
        .filter_map(|p| read_pub(&p).ok())
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.truncate(MAX_FILES);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ED: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl ana@pc";

    #[test]
    fn public_key_line_parse() {
        let (line, ty, comment) = parse_public_key_line(&format!("\n# c\n{ED}\n")).unwrap();
        assert_eq!(line, ED);
        assert_eq!(ty, "ssh-ed25519");
        assert_eq!(comment, "ana@pc");
        assert!(parse_public_key_line("-----BEGIN OPENSSH PRIVATE KEY-----\nabc").is_err());
        assert!(parse_public_key_line("hola mundo").is_err());
        assert!(parse_public_key_line("ssh-ed25519 ;rm -rf").is_err());
    }

    #[test]
    fn read_pub_only_reads_pub_files() {
        let dir = std::env::temp_dir().join(format!("tv-pub-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let pubf = dir.join("id_ed25519.pub");
        fs::write(&pubf, format!("{ED}\n")).unwrap();
        let priv_f = dir.join("id_ed25519");
        fs::write(&priv_f, "-----BEGIN OPENSSH PRIVATE KEY-----\n").unwrap();
        let fake = dir.join("trampa.pub");
        fs::write(&fake, "-----BEGIN OPENSSH PRIVATE KEY-----\n").unwrap();
        let other = dir.join("SOLA.PUB");
        fs::write(&other, format!("  {ED}  \n")).unwrap();

        let k = read_pub(&pubf).unwrap();
        assert_eq!(k.line, ED);
        assert_eq!(k.key_type, "ssh-ed25519");
        assert_eq!(k.private_path.as_deref(), Some(priv_f.to_string_lossy().as_ref()));
        assert!(read_pub(&priv_f).is_err());
        assert!(read_pub(&fake).is_err());
        assert_eq!(read_pub(&other).unwrap().private_path, None, "sin privada al lado");
        #[cfg(unix)]
        {
            // Un enlace .pub que apunta a la llave privada tampoco vale.
            let link = dir.join("enlace.pub");
            std::os::unix::fs::symlink(&priv_f, &link).unwrap();
            assert!(read_pub(&link).is_err());
        }
        let list = list_public_keys(&dir);
        let names: Vec<_> = list.iter().map(|k| Path::new(&k.path).file_name().unwrap().to_owned()).collect();
        assert_eq!(names, ["SOLA.PUB", "id_ed25519.pub"], "solo las válidas, por ruta");
        fs::remove_dir_all(&dir).unwrap();
    }
}
