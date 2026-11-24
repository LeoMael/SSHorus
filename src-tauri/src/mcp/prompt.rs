//! Reconocer cuándo un programa pide una contraseña en su terminal (`run_with_password`).
//!
//! Solo se mira la línea que el programa dejó a medias (sin salto de línea al final): así esperan las
//! preguntas («Password: », «Enter passphrase: »). Una línea ya terminada que diga «password» es salida
//! normal, no una pregunta.

/// Palabras que delatan una pregunta de contraseña (en minúsculas).
const WORDS: &[&str] = &["password", "contraseña", "passphrase", "clave", "passwort"];
/// Largo máximo de la línea que se guarda (y que se enseña en el diálogo).
const MAX_LINE: usize = 1024;
const MAX_SHOWN_CHARS: usize = 200;

/// Lo que va quedando de la línea actual del terminal.
#[derive(Default)]
pub struct PromptDetector {
    line: Vec<u8>,
}

impl PromptDetector {
    /// Añade salida del programa. Un salto de línea (o retorno de carro) empieza una línea nueva.
    pub fn push(&mut self, data: &[u8]) {
        for &b in data {
            if b == b'\n' || b == b'\r' {
                self.line.clear();
            } else {
                self.line.push(b);
            }
        }
        if self.line.len() > MAX_LINE {
            let cut = self.line.len() - MAX_LINE;
            self.line.drain(..cut);
        }
    }

    /// Tras escribir la respuesta: lo que había ya no es una pregunta pendiente.
    pub fn answered(&mut self) {
        self.line.clear();
    }

    /// La pregunta pendiente, limpia, si la línea actual lo es. `hint`: texto que da la IA (sin
    /// distinguir mayúsculas); vale además de las palabras de siempre.
    pub fn prompt(&self, hint: Option<&str>) -> Option<String> {
        let text = strip_ansi(&String::from_utf8_lossy(&self.line));
        let text = text.trim();
        is_prompt(text, hint).then(|| shown(text))
    }
}

/// ¿Es `line` (ya sin espacios a los lados) una pregunta de contraseña?
pub fn is_prompt(line: &str, hint: Option<&str>) -> bool {
    if line.is_empty() {
        return false;
    }
    let low = line.to_lowercase();
    if let Some(h) = hint.map(str::trim).filter(|h| !h.is_empty())
        && low.contains(&h.to_lowercase())
    {
        return true;
    }
    let asks = low.ends_with(':') || low.ends_with('?') || low.ends_with('>');
    asks && WORDS.iter().any(|w| low.contains(w))
}

/// Texto para comparar preguntas («New password:» y «new password: » son la misma).
pub fn normalized(prompt: &str) -> String {
    prompt.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Los últimos `MAX_SHOWN_CHARS` caracteres (la pregunta está al final).
fn shown(text: &str) -> String {
    let n = text.chars().count();
    if n <= MAX_SHOWN_CHARS {
        return text.to_string();
    }
    format!("…{}", text.chars().skip(n - MAX_SHOWN_CHARS).collect::<String>())
}

/// Quita las secuencias de escape del terminal (colores, mover el cursor…) y otros caracteres de control.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    // CSI: parámetros y un byte final entre '@' y '~'.
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: hasta BEL o ESC \.
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' || (c == '\u{1b}' && chars.peek() == Some(&'\\')) {
                            chars.next_if_eq(&'\\');
                            break;
                        }
                    }
                }
                _ => {
                    chars.next();
                }
            }
        } else if !c.is_control() || c == '\t' {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detect(chunks: &[&str], hint: Option<&str>) -> Option<String> {
        let mut d = PromptDetector::default();
        for c in chunks {
            d.push(c.as_bytes());
        }
        d.prompt(hint)
    }

    #[test]
    fn preguntas_de_siempre() {
        for p in [
            "Password: ",
            "[sudo] password for test: ",
            "Contraseña: ",
            "Current password: ",
            "New password: ",
            "Retype new password: ",
            "Enter password: ",
            "Enter old passphrase: ",
            "Enter new passphrase (empty for no passphrase): ",
            "Password for 'https://u@github.com': ",
            "Nueva CLAVE:",
            "Passwort: ",
        ] {
            assert!(detect(&[p], None).is_some(), "«{p}»");
        }
    }

    #[test]
    fn no_son_preguntas() {
        // Línea terminada, sin dos puntos, o sin la palabra.
        assert_eq!(detect(&["Password: \n"], None), None);
        assert_eq!(detect(&["Changing password for user test."], None), None);
        assert_eq!(detect(&["Username for 'https://github.com': "], None), None);
        assert_eq!(detect(&["passwd: password updated successfully\r\n"], None), None);
        assert_eq!(detect(&[""], None), None);
    }

    #[test]
    fn pregunta_partida_en_trozos_y_con_colores() {
        assert_eq!(detect(&["salida\r\nEnter pa", "ss", "word: "], None).as_deref(), Some("Enter password:"));
        assert_eq!(detect(&["\u{1b}[1;32mPassword:\u{1b}[0m "], None).as_deref(), Some("Password:"));
        // Un carácter de varios bytes partido entre dos trozos.
        let bytes = "Contraseña: ".as_bytes();
        let mut d = PromptDetector::default();
        d.push(&bytes[..9]);
        d.push(&bytes[9..]);
        assert_eq!(d.prompt(None).as_deref(), Some("Contraseña:"));
    }

    #[test]
    fn pista_de_la_ia() {
        assert_eq!(detect(&["Token secreto > "], None), None, "sin la palabra ni pista no es pregunta");
        assert_eq!(detect(&["Escribe el token "], None), None);
        assert_eq!(detect(&["Escribe el TOKEN "], Some("token")).as_deref(), Some("Escribe el TOKEN"));
        assert_eq!(detect(&["Escribe el token "], Some("   ")), None);
    }

    #[test]
    fn tras_responder_se_olvida_la_linea() {
        let mut d = PromptDetector::default();
        d.push(b"Password: ");
        assert!(d.prompt(None).is_some());
        d.answered();
        assert_eq!(d.prompt(None), None);
        d.push(b"Retype password: ");
        assert_eq!(d.prompt(None).as_deref(), Some("Retype password:"));
    }

    #[test]
    fn comparar_preguntas() {
        assert_eq!(normalized(" New   Password: "), normalized("new password:"));
        assert_ne!(normalized("New password:"), normalized("Retype new password:"));
    }
}
