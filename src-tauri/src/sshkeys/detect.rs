//! Detección de llaves privadas en una carpeta: archivos con su `.pub` al lado o con cabecera de
//! llave privada (OpenSSH o PEM). Lee el archivo solo para saber su tipo, si tiene frase y su
//! parte pública; nunca devuelve el contenido secreto.

use std::fs;
use std::path::{Path, PathBuf};

use russh::keys::PrivateKey;
use serde::Serialize;

use super::hosts::ConfigHost;

/// Máximo de llaves listadas.
const MAX_KEYS: usize = 64;
/// Una RSA de 16384 bits ocupa ~12 KiB: lo que pase de esto no es una llave.
const MAX_PRIVATE_BYTES: u64 = 64 * 1024;
const MAX_PUB_BYTES: u64 = 16 * 1024;

/// Archivos de ~/.ssh que nunca son llaves.
const NOT_KEYS: &[&str] = &[
    "known_hosts",
    "known_hosts.old",
    "known_hosts2",
    "config",
    "authorized_keys",
    "authorized_keys2",
    "environment",
    "rc",
];

/// Llaves por defecto de OpenSSH, de la más recomendada a la menos (la primera se preselecciona).
const DEFAULT_NAMES: &[&str] = &["id_ed25519", "id_ecdsa", "id_rsa", "id_ed25519_sk", "id_ecdsa_sk", "id_dsa"];

/// Tipo OpenSSH (o su prefijo) → tipo corto.
const KINDS: &[(&str, &str)] = &[
    ("ssh-ed25519", "ed25519"),
    ("ssh-rsa", "rsa"),
    ("ssh-dss", "dsa"),
    ("ecdsa-sha2-", "ecdsa"),
    ("sk-ssh-ed25519@openssh.com", "ed25519-sk"),
    ("sk-ecdsa-sha2-nistp256@openssh.com", "ecdsa-sk"),
];

/// Cabeceras PEM (`-----BEGIN <etiqueta>PRIVATE KEY-----`) → tipo corto, si se sabe.
const PEM_LABELS: &[(&str, Option<&str>)] = &[
    ("RSA ", Some("rsa")),
    ("EC ", Some("ecdsa")),
    ("DSA ", Some("dsa")),
    ("ENCRYPTED ", None),
    ("", None),
];

const OPENSSH_HEADER: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";

/// Llave PRIVADA encontrada (solo datos para mostrarla).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPrivateKey {
    pub path: String,
    /// Nombre del archivo (p. ej. `id_ed25519`).
    pub name: String,
    /// `ed25519`, `rsa`, `ecdsa`, `dsa`, `ed25519-sk`… (None = no se sabe).
    pub kind: Option<String>,
    pub comment: String,
    /// Protegida con frase (None = no se sabe).
    pub encrypted: Option<bool>,
    /// Línea pública (del `.pub` o sacada de la privada OpenSSH).
    pub public_line: Option<String>,
    /// `Host` de ~/.ssh/config que la usan (se rellena aparte).
    pub config_hosts: Vec<ConfigHost>,
}

/// Lo que dice el contenido de la privada.
#[derive(Default)]
struct Inspected {
    kind: Option<String>,
    comment: String,
    encrypted: Option<bool>,
    public_line: Option<String>,
}

/// `ssh-ed25519` → `ed25519`.
pub(super) fn kind_from_type(ty: &str) -> Option<String> {
    KINDS
        .iter()
        .find(|(t, _)| if t.ends_with('-') { ty.starts_with(t) } else { ty == *t })
        .map(|(_, k)| (*k).to_string())
}

fn inspect_openssh(text: &str) -> Inspected {
    let Ok(k) = PrivateKey::from_openssh(text) else { return Inspected::default() };
    let public = k.public_key();
    Inspected {
        kind: kind_from_type(public.algorithm().as_str()),
        comment: AsRef::<str>::as_ref(k.comment()).trim().to_string(),
        encrypted: Some(k.is_encrypted()),
        public_line: public.to_openssh().ok(),
    }
}

fn inspect_pem(text: &str) -> Option<Inspected> {
    let (_, kind) = PEM_LABELS
        .iter()
        .find(|(label, _)| text.starts_with(&format!("-----BEGIN {label}PRIVATE KEY-----")))?;
    Some(Inspected {
        kind: kind.map(str::to_string),
        // PKCS#1 cifrada lleva «Proc-Type: 4,ENCRYPTED»; PKCS#8 cifrada, la etiqueta ENCRYPTED.
        encrypted: Some(text.contains("ENCRYPTED")),
        ..Inspected::default()
    })
}

/// None si el texto no es una llave privada.
fn inspect_private(text: &str) -> Option<Inspected> {
    let t = text.trim_start();
    if t.starts_with(OPENSSH_HEADER) { Some(inspect_openssh(t)) } else { inspect_pem(t) }
}

/// Primera línea no vacía del `.pub` que acompaña a `path`, si existe.
fn sibling_pub_line(path: &Path) -> Option<String> {
    let mut p = path.as_os_str().to_owned();
    p.push(".pub");
    let p = PathBuf::from(p);
    if !p.metadata().is_ok_and(|m| m.is_file() && m.len() <= MAX_PUB_BYTES) {
        return None;
    }
    let text = fs::read_to_string(&p).ok()?;
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

/// El `.pub` manda en tipo y comentario (en una privada cifrada el comentario va cifrado).
fn apply_pub_line(info: &mut Inspected, line: &str) {
    let mut parts = line.split_whitespace();
    if let Some(k) = parts.next().and_then(kind_from_type) {
        info.kind = Some(k);
    }
    let comment = parts.skip(1).collect::<Vec<_>>().join(" ");
    if !comment.is_empty() {
        info.comment = comment;
    }
}

fn private_key_info(path: &Path, name: String) -> Option<LocalPrivateKey> {
    let pub_line = sibling_pub_line(path);
    // Un archivo que no es una llave legible solo cuenta si tiene su .pub al lado.
    let inspected = fs::read_to_string(path).ok().and_then(|t| inspect_private(&t));
    if inspected.is_none() && pub_line.is_none() {
        return None;
    }
    let mut info = inspected.unwrap_or_default();
    if let Some(line) = &pub_line {
        apply_pub_line(&mut info, line);
    }
    Some(LocalPrivateKey {
        path: path.to_string_lossy().into_owned(),
        name,
        kind: info.kind,
        comment: info.comment,
        encrypted: info.encrypted,
        public_line: pub_line.or(info.public_line),
        config_hosts: Vec::new(),
    })
}

fn is_candidate(path: &Path, name: &str) -> bool {
    let skip = name.starts_with('.')
        || NOT_KEYS.contains(&name)
        || path.extension().is_some_and(|x| x.eq_ignore_ascii_case("pub"));
    !skip && path.metadata().is_ok_and(|m| m.is_file() && m.len() <= MAX_PRIVATE_BYTES)
}

/// Posición en la lista: primero las llaves por defecto de OpenSSH, luego el resto por nombre.
fn rank(name: &str) -> usize {
    DEFAULT_NAMES.iter().position(|d| *d == name).unwrap_or(DEFAULT_NAMES.len())
}

/// Llaves privadas de `dir`, las por defecto primero.
pub fn list_private_keys(dir: &Path) -> Vec<LocalPrivateKey> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<LocalPrivateKey> = rd
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = e.file_name().to_str()?.to_string();
            is_candidate(&path, &name).then(|| private_key_info(&path, name)).flatten()
        })
        .collect();
    out.sort_by(|a, b| rank(&a.name).cmp(&rank(&b.name)).then_with(|| a.name.cmp(&b.name)));
    out.truncate(MAX_KEYS);
    out
}
