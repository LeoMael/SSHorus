//! Usuarios protegidos: cuentas del servidor que el asistente no puede tocar (funciones puras).
//!
//! Valen en cualquier nivel de acceso, también en «Completo»:
//! - Comandos de la Biblioteca que cambian algo con un protegido en sus variables (su nombre, su home o su
//!   uid) → rechazados.
//! - Escribir (`write_file`, `upload`) dentro de su home → rechazado. Leer, según el nivel.
//! - Cambiar a ese usuario (`sudo -u`, `su`, `runuser`, `machinectl shell`, `systemctl -M usuario@`) →
//!   rechazado.
//! - Un comando libre que solo lo menciona no se puede analizar del todo: pregunta SIEMPRE (sin «Permitir
//!   siempre» ni modo automático) y el diálogo dice qué protegido toca. Avisa, pero no es infalible.

use std::collections::BTreeSet;

use regex::Regex;

/// Un protegido con lo que se sabe de él en el servidor (si no existe allí, solo el nombre).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Protected {
    pub name: String,
    pub uid: Option<u32>,
    /// Carpeta personal según /etc/passwd (o la habitual si no se pudo leer).
    pub home: String,
}

/// Nombre aceptable en la lista (sin espacios ni «:»; no hace falta que exista en el servidor).
pub fn clean_name(raw: &str) -> Option<String> {
    let n = raw.trim();
    let ok = !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || "._-$".contains(c));
    ok.then(|| n.to_string())
}

/// Limpia una lista: nombres válidos y sin repetir.
pub fn clean_list<'a>(names: impl IntoIterator<Item = &'a String>) -> BTreeSet<String> {
    names.into_iter().filter_map(|n| clean_name(n)).collect()
}

/// Carpeta personal habitual cuando no se puede leer /etc/passwd.
fn default_home(name: &str) -> String {
    if name == "root" {
        "/root".into()
    } else {
        format!("/home/{name}")
    }
}

/// Une los nombres protegidos con las líneas de `getent passwd` / `/etc/passwd`.
pub fn resolve(names: &BTreeSet<String>, passwd: &str) -> Vec<Protected> {
    names
        .iter()
        .map(|name| {
            let row = passwd.lines().map(|l| l.split(':').collect::<Vec<_>>()).find(|f| f.len() >= 6 && f[0] == name);
            match row {
                Some(f) => Protected {
                    name: name.clone(),
                    uid: f[2].parse().ok(),
                    home: if f[5].starts_with('/') && f[5] != "/" { f[5].to_string() } else { default_home(name) },
                },
                None => Protected { name: name.clone(), uid: None, home: default_home(name) },
            }
        })
        .collect()
}

/// Comando que lista solo esos usuarios (getent; sin getent, como en busybox, el /etc/passwd entero).
pub fn passwd_command(names: &BTreeSet<String>) -> String {
    let list: Vec<String> = names.iter().map(|n| super::template::shell_quote(n)).collect();
    format!("getent passwd {} 2>/dev/null || cat /etc/passwd", list.join(" "))
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// ¿`word` aparece en `text` como palabra suelta (no dentro de otra, como «root» en «chroot»)?
fn has_word(text: &str, word: &str) -> bool {
    text.match_indices(word).any(|(i, _)| {
        let before = text[..i].chars().next_back();
        let after = text[i + word.len()..].chars().next();
        before.is_none_or(|c| !is_name_char(c) && c != '.') && after.is_none_or(|c| !is_name_char(c))
    })
}

/// ¿La ruta `home` aparece en `text` (seguida de fin, «/» u otro separador)?
fn has_path(text: &str, home: &str) -> bool {
    home.len() > 1
        && text.match_indices(home).any(|(i, _)| {
            text[i + home.len()..].chars().next().is_none_or(|c| !is_name_char(c) && c != '.')
        })
}

/// ¿El uid aparece donde suele indicar un usuario (`#1001`, `uid=1001`, `-u 1001`, `1001:`, `chown 1001`)?
fn has_uid(text: &str, uid: u32) -> bool {
    let re = format!(r"(?:#|uid[=\s]+|-u\s*|--uid[=\s]+|chown\s+(?:-\S+\s+)*){uid}\b|(?:^|[\s=]){uid}:");
    Regex::new(&re).is_ok_and(|r| r.is_match(text))
}

/// Protegidos que el texto menciona (por nombre, carpeta personal o uid).
pub fn mentioned(text: &str, users: &[Protected]) -> Vec<String> {
    users
        .iter()
        .filter(|u| {
            has_word(text, &u.name)
                || has_path(text, &u.home)
                || text.contains(&format!("~{}", u.name))
                || u.uid.is_some_and(|id| has_uid(text, id))
        })
        .map(|u| u.name.clone())
        .collect()
}

/// Protegidos a los que el comando se cambia de forma explícita (sudo -u, su, runuser, machinectl…).
pub fn switches_to(command: &str, users: &[Protected]) -> Vec<String> {
    const W: &str = r"(?:^|[\s;&|(`]|\$\()";
    const Q: &str = r#"['"]?"#;
    const END: &str = r#"(?:['"@]|\s|$|[;&|)])"#;
    users
        .iter()
        .filter(|u| {
            let mut who = vec![regex::escape(&u.name)];
            if let Some(id) = u.uid {
                who.push(format!("#{id}"));
            }
            let who = format!("(?:{})", who.join("|"));
            let n = regex::escape(&u.name);
            let patterns = [
                format!(r"{W}(?:sudo|doas)\s+(?:[^;&|]*\s)?(?:-u\s*|--user[=\s]+){Q}{who}{END}"),
                format!(r"{W}su\s+(?:-\S*\s+)*{Q}{n}{END}"),
                format!(r"{W}runuser\s+(?:[^;&|]*\s)?(?:-u\s+|-l\s+)?{Q}{n}{END}"),
                format!(r"{W}machinectl\s+(?:[^;&|]*\s)?(?:shell|login)\s+{Q}{n}@"),
                format!(r"(?:-M\s*|--machine[=\s]+){Q}{n}@"),
            ];
            patterns.iter().any(|p| Regex::new(p).is_ok_and(|r| r.is_match(command)))
        })
        .map(|u| u.name.clone())
        .collect()
}

/// Protegidos cuya carpeta personal contiene alguna de las rutas reales `paths`.
pub fn homes_hit(paths: &[String], users: &[Protected], real_homes: &[(String, String)]) -> Vec<String> {
    users
        .iter()
        .filter(|u| {
            let homes: Vec<&str> = std::iter::once(u.home.as_str())
                .chain(real_homes.iter().filter(|(n, _)| *n == u.name).map(|(_, h)| h.as_str()))
                .collect();
            paths.iter().any(|p| homes.iter().any(|h| *h != "/" && super::grants::within(h, p)))
        })
        .map(|u| u.name.clone())
        .collect()
}

pub fn denied_msg(server: &str, names: &[String]) -> String {
    format!(
        "En «{server}» {} protegido{}: el asistente no puede tocar{}. Lo decide el usuario en SSHorus → Ajustes → \
         Asistentes de IA (MCP).",
        quoted(names),
        if names.len() == 1 { " está" } else { "s están" },
        if names.len() == 1 { "lo" } else { "los" }
    )
}

/// Aviso del diálogo de permiso.
pub fn warning(names: &[String]) -> String {
    format!("Toca un usuario protegido: {}", names.join(", "))
}

fn quoted(names: &[String]) -> String {
    let q: Vec<String> = names.iter().map(|n| format!("«{n}»")).collect();
    q.join(", ")
}
