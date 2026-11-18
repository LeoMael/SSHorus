//! Conexión y comandos: `connect`, `run_command`, `run_catalog_command` y la ejecución con registro.

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::super::backend::Backend;
use super::super::policy::{self, Action};
use super::super::template;
use super::{marked, CatalogRunParams, ConnectParams, Fail, McpCore, Rec, Res, RunCommandParams, UI_CONNECT_TIMEOUT};
use crate::error::AppError;
use crate::types::{ExecResult, SnippetScope};

impl<B: Backend> McpCore<B> {
    pub(super) async fn connect(&self, p: ConnectParams, rec: &mut Rec) -> Res<String> {
        let t = self.target(&p.server, None, rec).await?;
        rec.entry.detail = format!("conectar a {}", t.server.name);
        if let Some(s) = &t.session {
            rec.entry.approved_by = Some(policy::AUTO_READ.into());
            return Ok(format!("Ya hay una conexión abierta con «{}»: sessionId {}", t.server.name, s.id));
        }
        let shown = format!("{}@{}:{}", t.server.username, t.server.host, t.server.port);
        self.authorize(rec, &t, Action::change_on_read("connect"), "quiere conectarse (se abre una pestaña)", &shown, None)
            .await?;
        let v = self
            .backend
            .ui_request("connect", json!({ "profileId": t.server.id }), UI_CONNECT_TIMEOUT)
            .await?;
        let sid = v.get("sessionId").and_then(Value::as_str).unwrap_or_default().to_string();
        if sid.is_empty() {
            return Err(Fail::Error(format!("No se pudo conectar a «{}».", t.server.name)));
        }
        Ok(format!("Conectado a «{}» (pestaña abierta en SSHorus): sessionId {sid}", t.server.name))
    }

    pub(super) async fn run_command(&self, p: RunCommandParams, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        let command = p.command.trim().to_string();
        rec.entry.detail = command.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        if command.is_empty() {
            return Err(Fail::Error("El comando está vacío.".into()));
        }
        if policy::looks_interactive(&command) {
            return Err(Fail::Error(
                "Ese comando es interactivo o no termina solo (top, vim, tail -f…): aquí se ejecuta sin terminal. \
                 Usa una versión que termine (p. ej. «tail -n 200» o «top -b -n 1»)."
                    .into(),
            ));
        }
        let sid = t.session_id()?.to_string();
        let protected = self.protected_in_command(&t, &command).await?;
        let action = Action::change(format!("run_command\n{command}"))
            .with_danger(policy::danger_reasons(&command))
            .with_protected(protected);
        self.authorize(rec, &t, action, "quiere ejecutar un comando", &command, None).await?;
        let sudo = policy::uses_sudo(&command);
        self.exec(rec, &t, &sid, &command, sudo, p.timeout_secs, p.max_output_kb, cancel).await
    }

    pub(super) async fn run_catalog(&self, p: CatalogRunParams, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        rec.entry.detail = p.id.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let entry = self
            .catalog()
            .await?
            .into_iter()
            .find(|e| e.id == p.id)
            .ok_or_else(|| Fail::Error(format!("No hay ningún comando con id «{}» (ver list_catalog).", p.id)))?;
        if entry.interactive {
            return Err(Fail::Error("Ese comando es interactivo: solo tiene sentido en una terminal.".into()));
        }
        if let Some((scope, id)) = &entry.scope {
            let fits = match scope {
                SnippetScope::Server => *id == t.server.id,
                SnippetScope::Project => self
                    .backend
                    .profiles()
                    .projects
                    .iter()
                    .any(|pr| pr.id == *id && pr.server_ids.contains(&t.server.id)),
                SnippetScope::Global => true,
            };
            if !fits {
                return Err(Fail::Error(format!("«{}» no es para este servidor.", entry.name)));
            }
        }
        let command = template::render(&entry.command, &p.vars).map_err(Fail::Error)?;
        rec.entry.detail = command.clone();
        let sid = t.session_id()?.to_string();
        let mut danger = policy::danger_reasons(&command);
        if entry.dangerous && danger.is_empty() {
            danger.push("marcado como peligroso en la Biblioteca".into());
        }
        // Con sudo SSHorus pone la contraseña: se pregunta siempre (como `sudo` en run_command).
        let sudo = entry.sudo || policy::uses_sudo(&command);
        if sudo && danger.is_empty() {
            danger.push("usa sudo (permisos de administrador)".into());
        }
        let action = if entry.is_read() && danger.is_empty() {
            Action::read(format!("catalog\n{command}"))
        } else {
            self.check_catalog_protected(&t, &p.vars, &command).await?;
            Action::change(format!("run_command\n{command}")).with_danger(danger).with_need(marked::catalog_need(&entry))
        };
        let title = format!("quiere ejecutar «{}» de la Biblioteca", entry.name);
        self.authorize(rec, &t, action, &title, &command, None).await?;
        self.exec(rec, &t, &sid, &command, sudo, p.timeout_secs, p.max_output_kb, cancel).await
    }

    /// Ejecuta tal cual (con `stdin` si lo hay), con registro y cancelación.
    pub(super) async fn exec_raw(
        &self,
        rec: &mut Rec,
        session_id: &str,
        command: &str,
        stdin: Option<&[u8]>,
        timeout: u32,
        cancel: &CancellationToken,
    ) -> Res<ExecResult> {
        let exec_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
        rec.entry.exec_id = Some(exec_id.clone());
        rec.entry.message = Some("Ejecutando".into());
        self.audit.record(rec.entry.clone());
        rec.entry.message = None;

        // Si el cliente cancela la petición, se detiene también en el servidor.
        let run = self.backend.exec(session_id, command, stdin, timeout, &exec_id);
        tokio::pin!(run);
        let result = tokio::select! {
            r = &mut run => r,
            () = cancel.cancelled() => {
                self.backend.cancel_exec(&exec_id);
                run.await
            }
        };
        match result {
            Ok(r) => Ok(r),
            Err(AppError::Canceled) => Err(Fail::Error("Se canceló el comando (y se detuvo en el servidor).".into())),
            Err(e) => Err(e.into()),
        }
    }
}
