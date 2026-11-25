//! Ajustes de permisos para uno o varios servidores a la vez: nivel, casillas de «Solo lo marcado»,
//! plantillas y usuarios protegidos. La parte pura (`apply`) se prueba aparte; los comandos Tauri solo la
//! llaman y apagan el modo automático donde ya no vale.

use std::collections::BTreeSet;

use serde::Deserialize;
use tauri::{AppHandle, State};

use super::config::McpConfig;
use super::grants::{Grants, Template};
use super::policy::Access;
use super::{prune_auto, McpState};
use crate::error::AppResult;

/// Lo que se cambia en cada servidor elegido. Lo que es None no se toca.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rules {
    pub access: Option<Access>,
    /// Plantilla de casillas (implica «Solo lo marcado» si no se da `access`).
    pub template: Option<Template>,
    /// Casillas exactas (implica «Solo lo marcado» si no se da `access`).
    pub grants: Option<Grants>,
    /// Usuarios protegidos del servidor (reemplaza su lista; los globales van aparte).
    pub protected: Option<Vec<String>>,
}

/// Aplica `rules` a cada servidor de `ids`.
pub fn apply(cfg: &mut McpConfig, ids: &[String], rules: &Rules) {
    let marks = rules.template.is_some() || rules.grants.is_some();
    let access = rules.access.or(marks.then_some(Access::Custom));
    for id in ids.iter().map(|i| i.trim()).filter(|i| !i.is_empty()) {
        if let Some(a) = access {
            cfg.access.insert(id.to_string(), a);
        }
        if let Some(g) = &rules.grants {
            cfg.grants.insert(id.to_string(), g.clone());
        }
        if let Some(t) = rules.template {
            let next = t.apply(&cfg.grants_of(id));
            cfg.grants.insert(id.to_string(), next);
        }
        if let Some(p) = &rules.protected {
            cfg.protected_users.insert(id.to_string(), p.iter().cloned().collect::<BTreeSet<_>>());
        }
    }
}

/// Aplica nivel, casillas, plantilla o protegidos a uno o varios servidores.
#[tauri::command]
pub async fn mcp_apply_rules(
    app: AppHandle,
    state: State<'_, McpState>,
    server_ids: Vec<String>,
    rules: Rules,
) -> AppResult<McpConfig> {
    state.core.config.update(|c| apply(c, &server_ids, &rules))?;
    prune_auto(&app, &state)?;
    Ok(state.core.config.get())
}

/// Usuarios protegidos en todos los servidores.
#[tauri::command]
pub async fn mcp_set_protected_global(state: State<'_, McpState>, users: Vec<String>) -> AppResult<McpConfig> {
    state.core.config.update(|c| c.protected_global = users.into_iter().collect())
}
