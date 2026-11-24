//! Tapar contraseñas en lo que se devuelve a la IA: la salida de los comandos y de los archivos.
//!
//! Las que SSHorus acaba de escribir (sudo, `run_with_password`) se tapan siempre. Las guardadas del
//! servidor solo si son lo bastante largas (`MIN_KNOWN_LEN`): tapar una palabra corta y común («admin»)
//! en una salida cualquiera le diría a la IA justo cuál es la contraseña.

/// Lo que se ve en lugar de la contraseña.
pub const MASK: &str = "••••";

/// Largo mínimo de una contraseña guardada para taparla en salidas que no la usaron.
pub const MIN_KNOWN_LEN: usize = 6;

/// Cambia cada aparición de cada secreto por `MASK`. Primero los más largos (por si uno contiene a otro).
/// `cut_tail`: la salida se recortó al final; si termina con el principio de un secreto (cortado a la
/// mitad), también se tapa ese trozo.
pub fn redact_all(text: &mut String, secrets: &[&str], cut_tail: bool) {
    let mut list: Vec<&str> = secrets.iter().copied().filter(|s| !s.is_empty()).collect();
    list.sort_by_key(|s| std::cmp::Reverse(s.len()));
    list.dedup();
    for s in &list {
        if text.contains(s) {
            *text = text.replace(s, MASK);
        }
    }
    if cut_tail {
        for s in &list {
            if let Some(n) = partial_tail(text, s) {
                text.truncate(text.len() - n);
                text.push_str(MASK);
                break;
            }
        }
    }
}

/// Bytes del final de `text` que son el principio de `secret` (al menos 1, menos que el secreto entero).
fn partial_tail(text: &str, secret: &str) -> Option<usize> {
    (1..secret.len())
        .rev()
        .filter(|&n| secret.is_char_boundary(n) && n <= text.len() && text.is_char_boundary(text.len() - n))
        .find(|&n| text.ends_with(&secret[..n]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tapa_todas_las_apariciones() {
        let mut t = "clave=s3cr3t-ñ y otra vez s3cr3t-ñ.".to_string();
        redact_all(&mut t, &["s3cr3t-ñ"], false);
        assert_eq!(t, "clave=•••• y otra vez ••••.");
    }

    #[test]
    fn primero_la_mas_larga() {
        let mut t = "abc123456 abc".to_string();
        redact_all(&mut t, &["abc", "abc123456"], false);
        assert_eq!(t, "•••• ••••");
    }

    #[test]
    fn trozo_cortado_al_final() {
        let mut t = "salida: hunter2-lar".to_string();
        redact_all(&mut t, &["hunter2-largo"], true);
        assert_eq!(t, "salida: ••••");
        // Sin recorte no se toca (podría ser texto normal).
        let mut t = "salida: hunter2-lar".to_string();
        redact_all(&mut t, &["hunter2-largo"], false);
        assert_eq!(t, "salida: hunter2-lar");
    }

    #[test]
    fn vacios_y_caracteres_de_varios_bytes() {
        let mut t = "nada que tapar ñ".to_string();
        redact_all(&mut t, &["", "zzz"], true);
        assert_eq!(t, "nada que tapar ñ");
        let mut t = "x contraseñ".to_string();
        redact_all(&mut t, &["contraseña"], true);
        assert_eq!(t, "x ••••");
    }
}
