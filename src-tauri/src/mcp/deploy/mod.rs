//! Desplegar un proyecto con la IA (funciones puras, sin Tauri ni conexión).
//!
//! - `guide`: la receta que sigue la IA (`get_deploy_guide`).
//! - `check`: validación de los datos que manda la IA (nombres, imagen, dominio, variables…).
//! - `user_script`: script de `create_app_user` (usuario sin sudo, con linger y subuid/subgid).
//! - `app_unit` y `app_script`: lo que despliega `deploy_app` (unidad systemd de usuario con Podman sin root
//!   o un programa) y su script.
//! - `dns`: `check_dns` (a qué IP apunta el dominio y si es este servidor).
//! - `status`: `deploy_status` (servicio, puerto, respuesta HTTP y certificado).
//!
//! Todo valor que llega al servidor se valida aquí y va citado con `template::shell_quote`: nada de lo que
//! mande la IA puede ampliar el script.

pub mod app_script;
pub mod app_unit;
pub mod check;
pub mod dns;
pub mod guide;
pub mod status;
pub mod user_script;

#[cfg(test)]
mod tests;

/// Línea que sale con error `msg` (código 2 = dato no válido o falta algo).
pub(crate) fn fail(msg: &str) -> String {
    format!(
        "{{ echo {} >&2; exit 2; }}",
        super::template::shell_quote(msg)
    )
}

/// Comando que escribe `lines` en `file` (variable o ruta ya citada) de forma atómica.
pub(crate) fn write_lines(lines: &[String], file: &str) -> String {
    let quoted: Vec<String> = lines
        .iter()
        .map(|l| super::template::shell_quote(l))
        .collect();
    format!(
        "printf '%s\\n' {} > {file}.tmp && mv -f {file}.tmp {file}",
        quoted.join(" ")
    )
}
