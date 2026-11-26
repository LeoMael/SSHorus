//! «Auditar servidor» (Administración → Auditoría): historial de auditorías por servidor.
//!
//! Las comprobaciones (script de solo lectura, parseo y notas) se hacen en la interfaz
//! (`src/features/audit/`), que reutiliza Puertos, Sitios web, Contenedores y el escáner. El motor solo
//! guarda los informes en este equipo (`store`) para el historial, la comparación con la auditoría
//! anterior y la herramienta `get_audit_report` del servidor MCP (`mcp/server_audit.rs`).

pub mod commands;
pub mod model;
pub mod store;

#[cfg(test)]
mod tests;
