//! Biblioteca de comandos: "Mis comandos" guardados (~/.config/sshorus/commands.json)
//! y ejecución aparte con captura de salida (canal exec). DUEÑO: agente Comandos.

pub mod commands;
pub(crate) mod exec;
mod run;
mod store;
pub mod sudo;
#[cfg(test)]
mod tests;

pub use exec::ExecRegistry;
pub use store::SnippetStore;
