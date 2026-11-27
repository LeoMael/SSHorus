//! «Historial por servidor»: lo que se hizo en cada servidor y que no guarda ya otro sitio.
//!
//! - Comandos de la Biblioteca, «Ejecutar en varios servidores», tareas en segundo plano terminadas y,
//!   solo si el usuario lo activa, las líneas escritas en la terminal (`model::EventSource`).
//! - Un archivo por servidor, `<config>/sshorus/history/<idServidor>.jsonl`, con rotación (`store`).
//! - Antes de guardar se tapan contraseñas y llaves (`redact`): las guardadas del servidor, las llaves
//!   con forma conocida y lo que va tras `password=`, `--password`, `Bearer`…
//!
//! La interfaz junta esto con lo que ya se registra en otros sitios (Administración, el registro del
//! asistente de IA, auditorías y el escáner). El servidor MCP no tiene ninguna herramienta que lo lea.

pub mod commands;
pub mod model;
pub mod redact;
pub mod store;

#[cfg(test)]
mod tests;
