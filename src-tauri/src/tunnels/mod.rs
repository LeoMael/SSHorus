//! Túneles (port forwarding) por servidor: local (-L), remoto (-R) y SOCKS5 (-D).
//! DUEÑO: agente Túneles.
//!
//! - Definiciones guardadas por servidor en `<config_dir>/sshorus/tunnels.json` (`store`).
//! - En marcha por sesión (`manager`), con estado y contadores → evento `tunnel://status`.
//! - Los canales `forwarded-tcpip` del servidor llegan por `ssh::handler` → `remote`.

pub mod commands;
mod forward;
mod io;
mod local_ports;
mod manager;
mod remote;
mod socks;
mod store;
pub mod types;
mod watcher;

#[cfg(test)]
mod tests;

pub use manager::TunnelManager;
pub use remote::on_forwarded_tcpip;
