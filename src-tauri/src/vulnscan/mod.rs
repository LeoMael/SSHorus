//! Escáner de vulnerabilidades (v0.5.0). Diseño: `docs/PENDIENTES.md` sección 10 y
//! `docs/ARQUITECTURA.md` 16b.
//!
//! Responde: ¿qué software tiene el servidor y qué vulnerabilidades conocidas le afectan? La lista sale
//! SIEMPRE de bases de datos reales (OSV.dev, la herramienta de seguridad de la distro o Trivy), nunca
//! de una IA.
//!
//! - `scripts`: lo que se ejecuta en el servidor (solo lectura), fase por fase.
//! - `parse/`: lectura de esas salidas y de las herramientas de la distro.
//! - `ecosystem`: distro → ecosistema de OSV (lista fija y probada).
//! - `osv` + `cache`: cliente de OSV.dev (lotes de 1000, paginación, detalle con caché).
//! - `severity`: gravedad de la distro → CVSS → sin clasificar.
//! - `analyze`: junta las fuentes y quita duplicados por CVE; `kernel`: qué kernel cuenta y si hay que reiniciar.
//! - `rpmver`: versiones RPM (epoch, `~`, `^`) y rangos de OSV; `repo`: si tus repositorios ya traen la
//!   versión corregida (`dnf check-update`).
//! - `recheck`: «Volver a comprobar» el sistema tras arreglar (quita lo arreglado del informe).
//! - `store`: historial por servidor; `export`: JSON y Markdown.
//! - `commands`: comandos Tauri; `scan`: análisis completo sin sudo desde el motor (pruebas, MCP).
//!
//! Para reutilizar desde otros módulos: [`store::latest_report`] (último informe de un servidor) y
//! [`scan::scan_session`] (analizar por una sesión SSH abierta, sin sudo). El servidor MCP los usa en
//! `get_vuln_report` y `scan_vulnerabilities` (`mcp/core.rs`).

pub mod analyze;
mod analyze_merge;
pub mod cache;
pub mod commands;
pub mod ecosystem;
pub mod export;
pub mod kernel;
pub mod model;
pub mod osv;
mod osv_model;
pub mod parse;
pub mod recheck;
pub mod repo;
pub mod rpmver;
// Lo usan el servidor MCP (`scan_vulnerabilities`) y las pruebas.
pub mod scan;
pub mod scripts;
pub mod settings;
pub mod severity;
pub mod store;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_recheck;

#[cfg(test)]
mod tests_repo;

#[cfg(all(test, unix))]
mod tests_runtime;

#[cfg(test)]
mod live_tests;

pub use commands::*;
pub use settings::VulnScanSettings;
