//! Las páginas que ve el navegador durante la autorización: «Vuelve a SSHorus para aceptar» y los errores.
//!
//! Sin JavaScript ni nada externo, y sin secretos: la página de espera solo lleva el id de la petición, que no
//! sirve de nada por sí solo (el código va a la dirección de vuelta del cliente y sin su verificador PKCE no
//! se puede canjear). La página se recarga sola en la dirección de espera (`WAIT_PATH`), que responde cuando
//! decides en SSHorus; mientras, el navegador sigue mostrando este texto.

use super::metadata::WAIT_PATH;

/// Cabeceras de seguridad de todas las páginas (sin marcos, sin recursos externos, sin caché).
pub const CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'";

fn escape(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&#39;".into(),
            c => c.to_string(),
        })
        .collect()
}

fn shell(title: &str, head_extra: &str, body: &str) -> String {
    format!(
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">{head_extra}<title>{title}</title>\
<style>:root{{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--muted:#5d6675;--card:#fff;--line:#dfe3ea}}\
@media (prefers-color-scheme:dark){{:root{{--bg:#14171c;--fg:#e6e9ef;--muted:#9aa3b2;--card:#1c2028;--line:#2b313c}}}}\
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);\
font:15px/1.5 system-ui,-apple-system,\"Segoe UI\",sans-serif}}\
main{{max-width:440px;margin:16px;padding:28px 32px;background:var(--card);border:1px solid var(--line);border-radius:10px}}\
h1{{font-size:19px;margin:0 0 10px}}p{{margin:8px 0;color:var(--muted)}}</style></head>\
<body><main>{body}</main></body></html>"
    )
}

/// «Vuelve a SSHorus para aceptar»: se recarga sola en la espera de esta petición.
pub fn waiting(request_id: &str) -> String {
    let url = format!("{WAIT_PATH}?id={}", escape(request_id));
    shell(
        "Vuelve a SSHorus",
        &format!("<meta http-equiv=\"refresh\" content=\"1;url={url}\">"),
        "<h1>Vuelve a SSHorus para aceptar</h1>\
<p>Tu asistente pide usar tus servidores a través de SSHorus. Acepta o rechaza en la ventana de SSHorus y elige sus permisos.</p>\
<p>Cuando respondas, esta pestaña volverá sola a tu asistente. Tienes 2 minutos.</p>",
    )
}

/// Un error que no vuelve al cliente.
pub fn error(message: &str) -> String {
    shell(
        "SSHorus: no se pudo conectar",
        "",
        &format!("<h1>No se pudo conectar el asistente</h1><p>{}</p>", escape(message)),
    )
}
