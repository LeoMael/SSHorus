//! Comentario por defecto de una llave nueva: `usuario@equipo` (como hace ssh-keygen).

/// Nombre de este equipo, sin dominio y en minúsculas.
fn hostname() -> Option<String> {
    #[cfg(unix)]
    let name = {
        let mut buf = [0u8; 256];
        // SAFETY: el búfer es válido y gethostname escribe como mucho `len` bytes.
        let r = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
        if r != 0 {
            return None;
        }
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).into_owned()
    };
    #[cfg(not(unix))]
    let name = std::env::var("COMPUTERNAME").ok()?;
    let short = name.split('.').next().unwrap_or("").trim().to_lowercase();
    (!short.is_empty()).then_some(short)
}

/// Usuario de la sesión (Linux/macOS: USER; Windows: USERNAME).
fn username() -> Option<String> {
    ["USER", "USERNAME", "LOGNAME"]
        .iter()
        .find_map(|v| std::env::var(v).ok().filter(|s| !s.trim().is_empty()))
}

/// Quita lo que rompería `usuario@equipo` (espacios y arrobas).
fn clean(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && *c != '@').collect()
}

pub fn default_comment() -> String {
    let user = username().unwrap_or_else(|| "yo".into());
    let host = hostname().unwrap_or_else(|| "equipo".into());
    format!("{}@{}", clean(&user), clean(&host))
}
