//! Herramientas sin servidor: servidores, proyectos, conexiones y transferencias visibles.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::super::backend::Backend;
use super::super::policy::Access;
use super::output::{access_code, enum_text, pretty};
use super::super::caller::Caller;
use super::{McpCore, Res, TransferStatusParams};
use crate::types::TransferJob;

impl<B: Backend> McpCore<B> {
    pub(super) async fn list_servers(&self, caller: &Caller) -> Res<String> {
        let sessions = self.backend.sessions().await;
        let cfg = self.config.get();
        let list: Vec<Value> = self
            .visible_servers(caller)
            .into_iter()
            .map(|(s, a)| {
                let ids: Vec<&str> = sessions.iter().filter(|x| x.profile_id == s.id).map(|x| x.id.as_str()).collect();
                json!({
                    "id": s.id,
                    "name": s.name,
                    "host": s.host,
                    "port": s.port,
                    "user": s.username,
                    "access": access_code(a),
                    "accessLabel": a.label(),
                    "connected": !ids.is_empty(),
                    "sessionIds": ids,
                    "marked": (a == Access::Custom).then(|| cfg.grants_of(&s.id).describe()),
                    "protectedUsers": cfg.protected_of(&s.id),
                })
            })
            .collect();
        if list.is_empty() {
            return Ok("No tienes acceso a ningún servidor. El usuario puede darlo en SSHorus → Ajustes → Asistentes de IA (MCP).".into());
        }
        Ok(pretty(&list))
    }

    pub(super) fn list_projects(&self, caller: &Caller) -> Res<String> {
        let visible: BTreeMap<String, String> =
            self.visible_servers(caller).into_iter().map(|(s, _)| (s.id, s.name)).collect();
        let list: Vec<Value> = self
            .backend
            .profiles()
            .projects
            .into_iter()
            .filter_map(|p| {
                let servers: Vec<Value> = p
                    .server_ids
                    .iter()
                    .filter_map(|id| visible.get(id).map(|n| json!({ "id": id, "name": n })))
                    .collect();
                (!servers.is_empty()).then(|| json!({ "id": p.id, "name": p.name, "servers": servers }))
            })
            .collect();
        Ok(pretty(&list))
    }

    pub(super) async fn list_sessions(&self, caller: &Caller) -> Res<String> {
        let visible: BTreeSet<String> = self.visible_servers(caller).into_iter().map(|(s, _)| s.id).collect();
        let list: Vec<Value> = self
            .backend
            .sessions()
            .await
            .into_iter()
            .filter(|s| visible.contains(&s.profile_id))
            .map(|s| {
                json!({
                    "sessionId": s.id,
                    "serverId": s.profile_id,
                    "serverName": s.name,
                    "host": s.host,
                    "user": s.username,
                    "connectedAt": s.connected_at,
                })
            })
            .collect();
        Ok(pretty(&list))
    }

    pub(super) async fn transfer_status(&self, p: TransferStatusParams, caller: &Caller) -> Res<String> {
        let visible: BTreeSet<String> = self.visible_servers(caller).into_iter().map(|(s, _)| s.id).collect();
        let sessions: BTreeSet<String> = self
            .backend
            .sessions()
            .await
            .into_iter()
            .filter(|s| visible.contains(&s.profile_id))
            .map(|s| s.id)
            .collect();
        let jobs: Vec<TransferJob> = self
            .backend
            .transfers()
            .into_iter()
            .filter(|j| sessions.contains(&j.session_id))
            .filter(|j| p.batch_id.as_ref().is_none_or(|b| &j.batch_id == b))
            .collect();
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for j in &jobs {
            *counts.entry(enum_text(&j.status)).or_default() += 1;
        }
        let shown: Vec<Value> = jobs
            .iter()
            .take(200)
            .map(|j| {
                json!({
                    "id": j.id,
                    "batchId": j.batch_id,
                    "direction": enum_text(&j.direction),
                    "name": j.name,
                    "localPath": j.local_path,
                    "remotePath": j.remote_path,
                    "size": j.size,
                    "transferred": j.transferred,
                    "status": enum_text(&j.status),
                    "error": j.error,
                })
            })
            .collect();
        Ok(pretty(&json!({ "total": jobs.len(), "byStatus": counts, "jobs": shown })))
    }
}
