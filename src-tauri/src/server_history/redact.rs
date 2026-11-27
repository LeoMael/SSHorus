//! Tapar contraseñas y llaves antes de guardar una entrada del historial.
//!
//! Tres capas: las contraseñas guardadas del servidor (las largas, como en el MCP), las llaves con forma
//! conocida (`sk-ant-…`, `ghp_…`, `AKIA…`) y lo que sigue a lo que suele llevar un secreto
//! (`password=`, `--password`, `mysql -p…`, `Bearer …`, `usuario:clave@` en una URL,
//! `echo … | sudo -S`). Mejor tapar de más que guardar una contraseña.

use std::sync::LazyLock;

use regex::Regex;

use super::model::HistoryEvent;
use crate::mcp::redact::{redact_all, redact_token_patterns, MASK, MIN_KNOWN_LEN};

/// (expresión, reemplazo). En el reemplazo, `{M}` es la máscara; `$n` los grupos que se conservan.
const RULES: &[(&str, &str)] = &[
    // Llaves con prefijo conocido: GitHub, GitLab, Slack y AWS (las de Anthropic, en `redact_token_patterns`).
    (r"\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abpr]-)[A-Za-z0-9_\-]+", "{M}"),
    (r"\bAKIA[0-9A-Z]{16}\b", "{M}"),
    // `echo 'clave' | sudo -S …`
    (r#"(?i)\b(echo|printf)(\s+)("[^"]*"|'[^']*'|\S+)(\s*\|\s*sudo\b[^|\n]*\s-S\b)"#, "$1$2{M}$4"),
    // mysql/mariadb con la contraseña pegada a -p.
    (r#"(?i)\b((?:mysql|mariadb|mysqldump|mysqladmin)\b[^\n|;&]*?\s-p)("[^"]*"|'[^']*'|[^\s'"]\S*)"#, "$1{M}"),
    // sshpass -p clave
    (r#"(?i)\b(sshpass\s+-p\s*)("[^"]*"|'[^']*'|\S+)"#, "$1{M}"),
    // --password clave, --password=clave, -pass pass:clave…
    (
        r#"(?i)(\s--?(?:password|passwd|pass|passphrase|token|secret|api-?key|access-?key)(?:=|[ \t]+))("[^"]*"|'[^']*'|\S+)"#,
        "$1{M}",
    ),
    // PASSWORD=…, db_password: …, api_key=…, "token": "…"
    (
        r#"(?i)(\b[A-Za-z0-9_]*(?:pass(?:word|wd)?|pwd|secret|token|api_?key|access_?key)[A-Za-z0-9_]*"?[ \t]*[=:][ \t]*)("[^"]*"|'[^']*'|[^\s,;]+)"#,
        "$1{M}",
    ),
    // Authorization: Bearer …
    (r"(?i)\b(bearer[ \t]+|authorization:[ \t]*basic[ \t]+)[A-Za-z0-9._~+/=\-]{8,}", "$1{M}"),
    // usuario:clave@ en una URL
    (r"([A-Za-z][A-Za-z0-9+.\-]*://[^\s/:@]+:)[^\s@/]+@", "$1{M}@"),
];

static COMPILED: LazyLock<Vec<(Regex, String)>> = LazyLock::new(|| {
    RULES
        .iter()
        .filter_map(|(re, rep)| match Regex::new(re) {
            Ok(r) => Some((r, rep.replace("{M}", MASK))),
            Err(e) => {
                log::warn!("regla de tapado no válida ({re}): {e}");
                None
            }
        })
        .collect()
});

/// `text` con los secretos tapados. `known`: contraseñas guardadas del servidor (solo se tapan las largas).
pub fn redact_text(text: &str, known: &[&str]) -> String {
    let mut out = text.to_string();
    let long: Vec<&str> = known.iter().copied().filter(|s| s.chars().count() >= MIN_KNOWN_LEN).collect();
    redact_all(&mut out, &long, false);
    redact_token_patterns(&mut out);
    for (re, rep) in COMPILED.iter() {
        if re.is_match(&out) {
            out = re.replace_all(&out, rep.as_str()).into_owned();
        }
    }
    out
}

/// Tapa los secretos de todos los textos de la entrada.
pub fn redact_event(ev: &mut HistoryEvent, known: &[&str]) {
    ev.title = redact_text(&ev.title, known);
    ev.detail = redact_text(&ev.detail, known);
    ev.result = redact_text(&ev.result, known);
}
