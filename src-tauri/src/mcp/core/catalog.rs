//! Biblioteca de comandos: catálogo base (lo manda la interfaz) más «Mis comandos».

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::super::backend::Backend;
use super::super::template;
use super::{CatalogListParams, Fail, McpCore, Res, UI_SCAN_TIMEOUT};
use crate::types::SnippetScope;

/// Comando de la Biblioteca (catálogo base, enviado por la interfaz, o «Mis comandos»).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub category: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub command: String,
    #[serde(default)]
    pub dangerous: bool,
    #[serde(default)]
    pub sudo: bool,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub interactive: bool,
    /// Tarea de «Solo lo marcado» (`grants::Task`, p. ej. «users-create»). None = necesita comandos libres.
    #[serde(default)]
    pub perm: Option<String>,
    /// «Mis comandos» limitado a un servidor o proyecto: (alcance, id).
    #[serde(skip)]
    pub scope: Option<(SnippetScope, String)>,
}

impl CatalogEntry {
    /// Comando 📊 que se puede ejecutar sin preguntar.
    pub(super) fn is_read(&self) -> bool {
        self.read_only && !self.dangerous && !self.sudo && !self.interactive
    }
}

impl<B: Backend> McpCore<B> {
    pub(super) async fn catalog(&self) -> Res<Vec<CatalogEntry>> {
        let cached = self.catalog.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let mut base = match cached {
            Some(c) => c,
            None => {
                let v = self.backend.ui_request("catalog", json!({}), UI_SCAN_TIMEOUT).await?;
                let list: Vec<CatalogEntry> = serde_json::from_value(v)
                    .map_err(|e| Fail::Error(format!("catálogo no válido: {e}")))?;
                *self.catalog.lock().unwrap_or_else(|p| p.into_inner()) = Some(list.clone());
                list
            }
        };
        base.extend(self.backend.snippets().into_iter().map(|s| CatalogEntry {
            id: s.id,
            category: if s.category.trim().is_empty() { "Mis comandos".into() } else { s.category },
            name: s.name,
            description: s.description,
            command: s.command,
            dangerous: s.dangerous,
            sudo: s.sudo,
            read_only: s.read_only,
            interactive: false,
            perm: None,
            scope: match (s.scope, s.scope_id) {
                (SnippetScope::Global, _) | (_, None) => None,
                (scope, Some(id)) => Some((scope, id)),
            },
        }));
        Ok(base)
    }

    /// Para las pruebas: fija el catálogo base sin pedirlo a la interfaz.
    #[cfg(test)]
    pub fn set_catalog(&self, list: Vec<CatalogEntry>) {
        *self.catalog.lock().unwrap_or_else(|p| p.into_inner()) = Some(list);
    }

    pub(super) async fn list_catalog(&self, p: CatalogListParams) -> Res<String> {
        let cat = p.category.as_deref().map(|c| c.trim().to_lowercase()).filter(|c| !c.is_empty());
        let words: Vec<String> = p
            .query
            .as_deref()
            .unwrap_or("")
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();
        let list: Vec<Value> = self
            .catalog()
            .await?
            .into_iter()
            .filter(|e| !e.interactive)
            .filter(|e| cat.as_ref().is_none_or(|c| e.category.to_lowercase() == *c))
            .filter(|e| {
                let hay = format!("{} {} {}", e.name, e.description.as_deref().unwrap_or(""), e.command).to_lowercase();
                words.iter().all(|w| hay.contains(w))
            })
            .map(|e| {
                let vars: Vec<Value> = template::parse_vars(&e.command)
                    .into_iter()
                    .map(|(n, d)| json!({ "name": n, "default": d }))
                    .collect();
                json!({
                    "id": e.id,
                    "category": e.category,
                    "name": e.name,
                    "description": e.description,
                    "command": e.command,
                    "vars": vars,
                    "readOnly": e.is_read(),
                    "dangerous": e.dangerous,
                    "sudo": e.sudo,
                    "permission": e.perm,
                })
            })
            .collect();
        if list.is_empty() {
            return Ok("No hay comandos con ese filtro.".into());
        }
        Ok(format!(
            "{} comandos. Los de readOnly=true se ejecutan sin preguntar; el resto pide permiso en SSHorus.\n{}",
            list.len(),
            serde_json::to_string(&list).unwrap_or_default()
        ))
    }
}
