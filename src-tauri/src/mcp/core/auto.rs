//! «Aceptar automáticamente»: nivel vigente por servidor, temporal (en memoria) o guardado.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::super::backend::Backend;
use super::super::policy::{self, AutoGrant, AutoLevel};
use super::McpCore;
use crate::error::{AppError, AppResult};

/// Cuánto dura el modo «Aceptar automáticamente».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoDuration {
    #[serde(rename = "15m")]
    Min15,
    #[serde(rename = "1h")]
    Hour,
    /// Hasta cerrar SSHorus (en memoria).
    #[serde(rename = "session")]
    Session,
    /// Guardado en `mcp.json`.
    #[serde(rename = "always")]
    Always,
}

/// Modo automático activo de un servidor (para la interfaz).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoState {
    pub server_id: String,
    pub server_name: String,
    pub level: AutoLevel,
    /// Unix ms en que se apaga; None = hasta cerrar SSHorus o «siempre» (`saved`).
    pub until: Option<u64>,
    /// Guardado («siempre»).
    pub saved: bool,
}

impl<B: Backend> McpCore<B> {
    fn auto_temp(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, AutoGrant>> {
        self.auto_temp.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Nivel automático que vale ahora en un servidor (`now` en Unix ms).
    pub fn auto_level_at(&self, server_id: &str, now: u64) -> AutoLevel {
        let cfg = self.config.get();
        let temp = self.auto_temp().get(server_id).copied();
        policy::effective_auto(
            cfg.access_of(server_id),
            self.backend.vault_locked(),
            cfg.auto_accept.get(server_id).copied(),
            temp,
            now,
        )
    }

    /// Activa (o apaga con `AutoLevel::Off`) el modo automático de un servidor. Quita lo que hubiera
    /// antes (temporal y guardado). Solo con acceso Completo.
    pub fn set_auto_at(&self, server_id: &str, level: AutoLevel, duration: AutoDuration, now: u64) -> AppResult<()> {
        if level != AutoLevel::Off && !self.config.get().access_of(server_id).allows_auto() {
            return Err(AppError::Invalid(
                "El modo automático solo se puede usar en servidores con acceso Completo o Solo lo marcado.".into(),
            ));
        }
        let sid = server_id.to_string();
        let save = level != AutoLevel::Off && duration == AutoDuration::Always;
        self.config.update(|c| {
            if save {
                c.auto_accept.insert(sid.clone(), level);
            } else {
                c.auto_accept.remove(&sid);
            }
        })?;
        let mut temp = self.auto_temp();
        temp.remove(server_id);
        if level != AutoLevel::Off && !save {
            let until = match duration {
                AutoDuration::Min15 => Some(now + 15 * 60 * 1000),
                AutoDuration::Hour => Some(now + 60 * 60 * 1000),
                AutoDuration::Session | AutoDuration::Always => None,
            };
            temp.insert(server_id.to_string(), AutoGrant { level, until });
        }
        Ok(())
    }

    /// Apaga el modo automático en todos los servidores (temporal y guardado).
    pub fn auto_off_all(&self) -> AppResult<()> {
        self.auto_temp().clear();
        self.config.update(|c| c.auto_accept.clear())?;
        Ok(())
    }

    /// Servidores con el modo automático activo ahora (aunque SSHorus esté bloqueado: es lo que se
    /// configuró; mientras esté bloqueado no se acepta nada).
    pub fn auto_list_at(&self, now: u64) -> Vec<AutoState> {
        let cfg = self.config.get();
        let mut temp = self.auto_temp();
        temp.retain(|_, g| g.active(now));
        let names: BTreeMap<String, String> =
            self.backend.profiles().servers.into_iter().map(|s| (s.id, s.name)).collect();
        let mut out = Vec::new();
        for (id, name) in &names {
            if !cfg.access_of(id).allows_auto() {
                continue;
            }
            let (level, until, saved) = match temp.get(id) {
                Some(g) => (g.level, g.until, false),
                None => match cfg.auto_accept.get(id) {
                    Some(l) => (*l, None, true),
                    None => continue,
                },
            };
            out.push(AutoState { server_id: id.clone(), server_name: name.clone(), level, until, saved });
        }
        out
    }
}
