//! «Aceptar automáticamente»: nivel vigente por servidor, temporal (en memoria) o guardado.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::super::backend::Backend;
use super::super::policy::{self, Access, AutoGrant, AutoLevel};
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

    /// ¿Se puede usar el modo automático en este servidor? Con acceso Completo o Solo lo marcado para la
    /// conexión con el token general o para algún asistente emparejado.
    pub fn auto_allowed(&self, server_id: &str) -> bool {
        self.config.get().access_of(server_id).allows_auto() || self.paired.as_ref().is_some_and(|p| p.allows_auto(server_id))
    }

    /// Nivel automático que vale ahora en un servidor para quien tiene `access` en él (`now` en Unix ms):
    /// un asistente con Solo lectura nunca lo usa, aunque otro lo tenga activado ahí.
    pub fn auto_level_for(&self, server_id: &str, access: Access, now: u64) -> AutoLevel {
        let cfg = self.config.get();
        let temp = self.auto_temp().get(server_id).copied();
        policy::effective_auto(access, self.backend.vault_locked(), cfg.auto_accept.get(server_id).copied(), temp, now)
    }

    /// Lo mismo para la conexión con el token general.
    #[cfg(test)]
    pub fn auto_level_at(&self, server_id: &str, now: u64) -> AutoLevel {
        self.auto_level_for(server_id, self.config.get().access_of(server_id), now)
    }

    /// Apaga el modo automático donde ya nadie tiene acceso Completo o Solo lo marcado (tras cambiar
    /// permisos o revocar un asistente). true si apagó alguno.
    pub fn prune_auto_at(&self, now: u64) -> AppResult<bool> {
        let cfg = self.config.get();
        let ids: Vec<String> = cfg.auto_accept.keys().chain(self.auto_temp().keys()).cloned().collect();
        let mut changed = false;
        for id in ids.iter().filter(|id| !self.auto_allowed(id)) {
            self.set_auto_at(id, AutoLevel::Off, AutoDuration::Session, now)?;
            changed = true;
        }
        Ok(changed)
    }

    /// Activa (o apaga con `AutoLevel::Off`) el modo automático de un servidor. Quita lo que hubiera
    /// antes (temporal y guardado). Solo donde `auto_allowed`.
    pub fn set_auto_at(&self, server_id: &str, level: AutoLevel, duration: AutoDuration, now: u64) -> AppResult<()> {
        if level != AutoLevel::Off && !self.auto_allowed(server_id) {
            return Err(AppError::Invalid(
                "El modo automático solo se puede usar en servidores con acceso Completo o Solo lo marcado (para la conexión con token o para algún asistente conectado).".into(),
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
            if !self.auto_allowed(id) {
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
