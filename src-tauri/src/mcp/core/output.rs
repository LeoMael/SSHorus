//! Formato de las respuestas: JSON legible, listas, recortes y resultado de un comando.

use serde::Serialize;
use serde_json::{json, Value};

use super::super::policy::Access;
use super::{Fail, Res};
use crate::types::ExecResult;

pub(super) fn parse<T: serde::de::DeserializeOwned>(args: Value) -> Res<T> {
    let args = if args.is_null() { json!({}) } else { args };
    serde_json::from_value(args).map_err(|e| Fail::Error(format!("Parámetros no válidos: {e}")))
}

pub(super) fn pretty<T: Serialize>(v: &T) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

pub(super) fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

pub(super) fn bullet(items: &[String]) -> String {
    items.iter().map(|i| format!("• {i}")).collect::<Vec<_>>().join("\n")
}

pub(super) fn access_code(a: Access) -> &'static str {
    match a {
        Access::None => "none",
        Access::Read => "read",
        Access::Full => "full",
        Access::Custom => "custom",
    }
}

/// Valor de un enum serializado («running», «upload»…).
pub(super) fn enum_text<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

/// Recorta por el medio (se ven el principio y el final) respetando caracteres.
pub fn clip_middle(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let half = max / 2;
    let mut head = half;
    while !s.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = s.len() - half;
    while !s.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}\n[… se omitieron {} bytes …]\n{}", &s[..head], tail - head, &s[tail..])
}

pub(super) fn exec_summary(r: &ExecResult) -> String {
    if r.timed_out {
        return "Se cortó por tiempo".into();
    }
    match r.exit_code {
        Some(c) => format!("código {c}"),
        None => "sin código de salida".into(),
    }
}

/// Texto para el asistente: cabecera con el código y la duración, y las dos salidas recortadas.
pub fn format_exec(r: &ExecResult, max: usize) -> String {
    let mut out = String::new();
    let code = match r.exit_code {
        Some(c) => c.to_string(),
        None => "desconocido".into(),
    };
    out.push_str(&format!("Código de salida: {code} · {:.1} s", r.duration_ms as f64 / 1000.0));
    if r.timed_out {
        out.push_str(" · SE CORTÓ POR TIEMPO (el proceso remoto se detuvo)");
    }
    let mut clipped = r.truncated;
    let stdout = clip_middle(&r.stdout, max);
    let stderr = clip_middle(&r.stderr, max);
    clipped |= stdout.len() != r.stdout.len() || stderr.len() != r.stderr.len();
    if clipped {
        out.push_str(" · salida recortada");
    }
    out.push_str("\n--- stdout ---\n");
    out.push_str(&stdout);
    if !r.stderr.is_empty() {
        out.push_str("\n--- stderr ---\n");
        out.push_str(&stderr);
    }
    out
}
