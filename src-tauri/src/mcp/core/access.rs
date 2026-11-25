//! Servidor sobre el que se actúa, nivel de acceso y aprobación (reglas, modo automático o diálogo).

use std::collections::BTreeSet;

use super::super::approval::Decision;
use super::super::audit::now_ms;
use super::super::backend::Backend;
use super::super::caller::Caller;
use super::super::policy::{self, Access, Action, AutoLevel, Verdict};
use super::super::protect;
use super::{ask, Fail, McpCore, Rec, Res, Target};
use crate::types::ServerProfile;

impl<B: Backend> McpCore<B> {
    /// Servidores a los que tiene acceso quien llama.
    pub(super) fn visible_servers(&self, caller: &Caller) -> Vec<(ServerProfile, Access)> {
        let cfg = self.config.get();
        self.backend
            .profiles()
            .servers
            .into_iter()
            .filter_map(|s| {
                let a = caller.access_of(&cfg, &s.id);
                (a != Access::None).then_some((s, a))
            })
            .collect()
    }

    pub(super) async fn target(&self, server: &str, session_id: Option<&str>, rec: &mut Rec) -> Res<Target> {
        let wanted = server.trim();
        if wanted.is_empty() {
            return Err(Fail::Error("Falta el servidor (nombre o id; ver list_servers).".into()));
        }
        let servers = self.backend.profiles().servers;
        let found = match servers.iter().find(|s| s.id == wanted) {
            Some(s) => s.clone(),
            None => {
                let low = wanted.to_lowercase();
                let by_name: Vec<&ServerProfile> = servers.iter().filter(|s| s.name.trim().to_lowercase() == low).collect();
                match by_name.as_slice() {
                    [one] => (*one).clone(),
                    [] => return Err(Fail::Error(format!("No hay ningún servidor «{wanted}». Usa list_servers."))),
                    _ => {
                        return Err(Fail::Error(format!(
                            "Hay varios servidores llamados «{wanted}»: usa su id (ver list_servers)."
                        )))
                    }
                }
            }
        };
        rec.entry.server_id = Some(found.id.clone());
        rec.entry.server_name = Some(found.name.clone());
        let access = rec.caller.access_of(&self.config.get(), &found.id);
        if access == Access::None {
            return Err(Fail::Denied(policy::no_access_msg(&found.name)));
        }
        let sessions = self.backend.sessions().await;
        let session = match session_id.map(str::trim).filter(|s| !s.is_empty()) {
            Some(id) => match sessions.into_iter().find(|s| s.id == id) {
                Some(s) if s.profile_id == found.id => Some(s),
                Some(_) => {
                    return Err(Fail::Error(format!("La conexión {id} no es de «{}».", found.name)));
                }
                None => return Err(Fail::Error(format!("La conexión {id} no existe o ya se cerró."))),
            },
            None => sessions.into_iter().filter(|s| s.profile_id == found.id).max_by_key(|s| s.connected_at),
        };
        Ok(Target { server: found, access, session })
    }

    /// Aplica las reglas y, si hace falta, pregunta en SSHorus.
    pub(super) async fn authorize(&self, rec: &mut Rec, t: &Target, action: Action, title: &str, shown: &str, diff: Option<String>) -> Res<()> {
        let cfg = self.config.get();
        let auto = self.auto_level_for(&t.server.id, t.access, now_ms());
        let grants = cfg.grants_of(&t.server.id);
        match policy::decide_rules(&t.server.name, t.access, &grants, &action, &cfg.remembered_of(&t.server.id), auto) {
            Verdict::Allow(why) => {
                rec.entry.approved_by = Some(why.to_string());
                Ok(())
            }
            Verdict::AutoAllow { danger } => {
                rec.entry.approved_by = Some(if danger { policy::AUTO_DANGER } else { policy::AUTO_CHANGE }.to_string());
                rec.entry.auto = true;
                rec.entry.auto_danger = danger;
                Ok(())
            }
            Verdict::Deny(msg) => Err(Fail::Denied(msg)),
            Verdict::Ask { can_remember } => {
                let mut danger = action.danger.clone();
                if !action.protected.is_empty() {
                    danger.insert(0, protect::warning(&action.protected));
                }
                let ask = ask::Ask { title, shown, diff, danger, can_remember };
                match self.ask_user(rec, t, ask).await? {
                    Decision::Once => {
                        rec.entry.approved_by = Some("tú: una vez".into());
                        Ok(())
                    }
                    Decision::Always if can_remember => {
                        let key = action.key.clone();
                        let sid = t.server.id.clone();
                        if let Err(e) = self.config.update(|c| {
                            c.remembered.entry(sid).or_default().insert(key);
                        }) {
                            log::warn!("no se pudo guardar «permitir siempre»: {e}");
                        }
                        rec.entry.approved_by = Some("tú: siempre en este servidor".into());
                        Ok(())
                    }
                    Decision::Always => {
                        rec.entry.approved_by = Some("tú: una vez (peligroso, no se recuerda)".into());
                        Ok(())
                    }
                    Decision::Deny => {
                        rec.entry.approved_by = Some("tú: denegado".into());
                        Err(Fail::Denied("El usuario lo denegó en SSHorus.".into()))
                    }
                }
            }
        }
    }

    /// Solo el rechazo de las reglas (sin preguntar ni modo automático): para no leer nada si no se permite.
    pub(super) fn precheck(&self, t: &Target, action: Action) -> Res<()> {
        let cfg = self.config.get();
        let grants = cfg.grants_of(&t.server.id);
        match policy::decide_rules(&t.server.name, t.access, &grants, &action, &BTreeSet::new(), AutoLevel::Off) {
            Verdict::Deny(msg) => Err(Fail::Denied(msg)),
            _ => Ok(()),
        }
    }
}
