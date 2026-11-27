//! Validación de lo que manda la IA para desplegar. Cada función devuelve el valor limpio o un mensaje
//! en español listo para el asistente. Reglas estrictas a propósito: lo que no encaja, no se ejecuta.

use std::collections::BTreeMap;

/// Usuario de Linux para una app: minúsculas, dígitos, «_» y «-»; empieza por letra o «_»; hasta 32.
pub fn user_name(raw: &str) -> Result<String, String> {
    let n = raw.trim();
    let first_ok = n
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c == '_');
    let ok = first_ok
        && n.len() <= 32
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    if !ok {
        return Err(format!(
            "«{n}» no es un nombre de usuario válido (minúsculas, números, «_» o «-», empieza por letra; hasta 32)."
        ));
    }
    if n == "root" {
        return Err(
            "No se puede usar root para una app: crea un usuario aparte con create_app_user."
                .into(),
        );
    }
    Ok(n.to_string())
}

/// Nombre de la app (servicio, contenedor y carpeta): minúsculas, dígitos, «_», «-» y «.»; hasta 48.
pub fn app_name(raw: &str) -> Result<String, String> {
    let n = raw.trim();
    let first_ok = n
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let ok = first_ok
        && n.len() <= 48
        && !n.contains("..")
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_-.".contains(c));
    if ok {
        Ok(n.to_string())
    } else {
        Err(format!(
            "«{n}» no es un nombre de app válido (minúsculas, números, «-», «_» o «.»; hasta 48)."
        ))
    }
}

/// Imagen de contenedor («docker.io/library/nginx:1.27», «ghcr.io/org/app@sha256:…»).
pub fn image(raw: &str) -> Result<String, String> {
    let i = raw.trim();
    let first_ok = i.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    let ok = first_ok
        && i.len() <= 255
        && i.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._/:@-".contains(c));
    if ok {
        Ok(i.to_string())
    } else {
        Err(format!(
            "«{i}» no parece una imagen de contenedor (p. ej. docker.io/library/nginx:1.27)."
        ))
    }
}

/// Dominio en minúsculas (sin comodines, sin puerto ni esquema).
pub fn domain(raw: &str) -> Result<String, String> {
    let d = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    let label_ok = |l: &str| {
        !l.is_empty()
            && l.len() <= 63
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    };
    let labels: Vec<&str> = d.split('.').collect();
    let ok = d.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|l| label_ok(l))
        && d.parse::<std::net::IpAddr>().is_err();
    if ok {
        Ok(d)
    } else {
        Err(format!(
            "«{}» no es un dominio válido (p. ej. app.ejemplo.com, sin http:// ni puerto).",
            raw.trim()
        ))
    }
}

/// Puerto TCP (1-65535).
pub fn port(p: u32) -> Result<u16, String> {
    u16::try_from(p)
        .ok()
        .filter(|p| *p > 0)
        .ok_or_else(|| format!("El puerto {p} no es válido (1-65535)."))
}

/// Nombre de unidad systemd («caddy», «miapp.service»).
pub fn unit(raw: &str) -> Result<String, String> {
    let u = raw.trim();
    let ok = !u.is_empty()
        && u.len() <= 128
        && !u.starts_with('-')
        && u.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-.@:".contains(c));
    if ok {
        Ok(u.to_string())
    } else {
        Err(format!("«{u}» no es un nombre de servicio válido."))
    }
}

/// Llave pública SSH de una sola línea.
pub fn public_key(raw: &str) -> Result<String, String> {
    let k = raw.trim();
    let kinds = [
        "ssh-ed25519 AAAA",
        "ssh-rsa AAAA",
        "ecdsa-sha2-nistp",
        "sk-ssh-ed25519@openssh.com AAAA",
        "sk-ecdsa-sha2-nistp",
    ];
    let ok = kinds.iter().any(|p| k.starts_with(p))
        && !k.contains(['\n', '\r', '\0'])
        && k.len() <= 16 * 1024;
    if ok {
        Ok(k.to_string())
    } else {
        Err("No parece una llave pública SSH (una línea que empieza por ssh-ed25519, ssh-rsa o ecdsa-…).".into())
    }
}

/// Variables de entorno: nombres `[A-Za-z_][A-Za-z0-9_]*`, valores de una línea. `single_quoted` = el valor
/// irá entre comillas simples (EnvironmentFile de systemd), así que no puede llevar «'».
pub fn env(vars: &BTreeMap<String, String>, single_quoted: bool) -> Result<(), String> {
    for (k, v) in vars {
        let name_ok = k
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !name_ok {
            return Err(format!(
                "«{k}» no es un nombre de variable válido (letras, números y «_»)."
            ));
        }
        if v.chars().any(char::is_control) {
            return Err(format!(
                "El valor de {k} no puede tener saltos de línea ni caracteres de control."
            ));
        }
        if single_quoted && v.contains('\'') {
            return Err(format!(
                "El valor de {k} no puede llevar comillas simples (') en un servicio."
            ));
        }
    }
    Ok(())
}

/// Volumen «subcarpeta:/ruta/en/el/contenedor». La subcarpeta queda dentro de la carpeta de la app.
pub fn volume(raw: &str) -> Result<(String, String), String> {
    let bad = || {
        format!(
            "«{raw}» no es un volumen válido: usa «subcarpeta:/ruta/en/el/contenedor» (p. ej. data:/var/lib/app)."
        )
    };
    let (dir, target) = raw.trim().split_once(':').ok_or_else(bad)?;
    let dir_ok = !dir.is_empty()
        && !dir.starts_with('.')
        && dir.split('/').all(|p| !p.is_empty() && p != "..")
        && dir
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-./".contains(c));
    let target_ok = target.starts_with('/')
        && target.len() > 1
        && !target.split('/').any(|p| p == "..")
        && target
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-./".contains(c));
    if dir_ok && target_ok {
        Ok((
            dir.trim_end_matches('/').to_string(),
            target.trim_end_matches('/').to_string(),
        ))
    } else {
        Err(bad())
    }
}

/// Orden de arranque de un servicio (ExecStart): una línea sin caracteres de control. Relativa = dentro de
/// la carpeta de la app. Los «%» se doblan (systemd los usa como especificadores).
pub fn exec_start(raw: &str, app: &str) -> Result<String, String> {
    let c = raw.trim();
    if c.is_empty() || c.chars().any(char::is_control) || c.len() > 2000 {
        return Err("exec_start debe ser una sola línea con el programa y sus argumentos.".into());
    }
    let c = c.replace('%', "%%");
    Ok(if c.starts_with('/') {
        c
    } else {
        format!("%h/apps/{app}/{}", c.trim_start_matches("./"))
    })
}

/// Ruta absoluta en el servidor (carpeta o archivo subido), sin «..» ni caracteres de control.
pub fn server_path(raw: &str, what: &str) -> Result<String, String> {
    let p = raw.trim();
    let ok = p.starts_with('/')
        && !p.split('/').any(|s| s == "..")
        && !p.chars().any(char::is_control)
        && p.len() > 1;
    if ok {
        Ok(p.trim_end_matches('/').to_string())
    } else {
        Err(format!(
            "{what} debe ser una ruta absoluta del servidor (p. ej. /home/usuario/sshorus-deploy/app)."
        ))
    }
}
