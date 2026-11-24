//! Pruebas de `run_with_password` con el motor simulado de `tests.rs` (terminal de mentira de
//! `pty_run_tests.rs`), de lo que se anuncia según «La IA puede pedir ver la contraseña de sudo» y de las
//! contraseñas guardadas tapadas en `run_command`.

use std::collections::VecDeque;

use super::*;
use crate::mcp::backend::SavedPassword;
use crate::mcp::core::AutoDuration;
use crate::mcp::policy::AutoLevel;
use crate::mcp::pty_run::tests::{data, Fake};
use crate::mcp::pty_run::{drive, PromptAsk, PtyEvent, PtyOptions, PtyOutcome};
use crate::mcp::redact::MASK;
use crate::mcp::server;

const LOGIN_PW: &str = "conexion-pw1";

/// Guion de la terminal simulada: lo que sale al empezar y lo que sale tras cada escritura.
type PtyScript = (Vec<String>, Vec<Vec<String>>);

/// Lo que el Mock necesita para `run_with_password`.
#[derive(Default)]
pub(super) struct MockPasswords {
    login: Mutex<Option<String>>,
    sudo: Mutex<Option<String>>,
    /// Respuestas a «password-run» y «password-prompt», en orden (si no hay: «no»).
    replies: Mutex<VecDeque<Value>>,
    /// Terminal: lo que sale al empezar y tras cada escritura (con «\0» = el programa termina con código 0).
    script: Mutex<Option<PtyScript>>,
    written: Arc<Mutex<Vec<Vec<u8>>>>,
    commands: Mutex<Vec<String>>,
}

fn events(chunks: &[String]) -> Vec<PtyEvent> {
    chunks
        .iter()
        .flat_map(|c| if c == "\0" { vec![PtyEvent::Exit(0), PtyEvent::Closed] } else { vec![data(c)] })
        .collect()
}

impl MockPasswords {
    pub(super) fn saved(&self, kind: SavedPassword) -> Option<Zeroizing<String>> {
        let v = match kind {
            SavedPassword::Login => self.login.lock().unwrap().clone(),
            SavedPassword::Sudo => self.sudo.lock().unwrap().clone(),
        };
        v.map(Zeroizing::new)
    }

    pub(super) fn reply(&self) -> Value {
        self.replies.lock().unwrap().pop_front().unwrap_or_else(|| json!({ "canceled": true }))
    }

    pub(super) async fn run(&self, command: &str, opts: PtyOptions, prompts: tokio::sync::mpsc::Sender<PromptAsk>) -> AppResult<PtyOutcome> {
        self.commands.lock().unwrap().push(command.to_string());
        let (start, after) = self.script.lock().unwrap().clone().unwrap_or_default();
        let mut fake = Fake::new(events(&start), after.iter().map(|a| events(a)).collect());
        fake.written = self.written.clone();
        Ok(drive(&mut fake, &opts, &CancellationToken::new(), &prompts).await)
    }
}

fn set_script(c: &McpCore<Mock>, start: &[&str], after: &[&[&str]]) {
    let own = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    *c.backend.password.script.lock().unwrap() = Some((own(start), after.iter().map(|a| own(a)).collect()));
}

fn set_replies(c: &McpCore<Mock>, r: Vec<Value>) {
    *c.backend.password.replies.lock().unwrap() = r.into();
}

/// passwd como root: «New password» y «Retype new password»; el programa repite lo que leyó (para ver que
/// se tapa).
fn passwd_core() -> McpCore<Mock> {
    let c = core();
    *c.backend.password.login.lock().unwrap() = Some(LOGIN_PW.into());
    set_script(
        &c,
        &["Changing password for deploy.\r\nNew password: "],
        &[&["\r\nRetype new password: "], &["\r\nleí conexion-", "pw1\r\npasswd: password updated successfully\r\n", "\0"]],
    );
    c
}

async fn run_pw(c: &McpCore<Mock>, server: &str) -> ToolOutput {
    call(c, "run_with_password", json!({ "server": server, "command": "passwd deploy", "reason": "cambiar la contraseña de deploy" })).await
}

fn written(c: &McpCore<Mock>) -> Vec<Vec<u8>> {
    c.backend.password.written.lock().unwrap().clone()
}

#[tokio::test]
async fn guardada_y_luego_la_misma_la_ia_nunca_la_ve() {
    let c = passwd_core();
    set_replies(&c, vec![json!({ "source": "login", "sameForAll": false }), json!({ "reuse": 0 })]);
    let out = run_pw(&c, "web-prod").await;
    assert!(!out.is_error, "{}", out.text);
    assert!(!out.text.contains("conexion-") && !out.text.contains("pw1"), "{}", out.text);
    assert!(out.text.contains(&format!("leí {MASK}")), "{}", out.text);
    assert!(out.text.contains("«New password:»") && out.text.contains("«Retype new password:»"), "{}", out.text);
    assert_eq!(written(&c), vec![format!("{LOGIN_PW}\n").into_bytes(); 2]);

    // Diálogo propio (no el de permiso), con lo que necesita la interfaz; luego, la segunda pregunta.
    assert_eq!(asked(&c), 0);
    assert_eq!(ui_kinds(&c), ["password-run", "password-prompt"]);
    let payloads = c.backend.ui_payloads.lock().unwrap().clone();
    let first = &payloads[0].1;
    assert_eq!(first["command"], "passwd deploy");
    assert_eq!(first["reason"], "cambiar la contraseña de deploy");
    assert_eq!(first["serverName"], "web-prod");
    assert_eq!(first["sessionId"], "ss-full");
    assert_eq!((first["hasLogin"].as_bool(), first["hasSudo"].as_bool()), (Some(true), Some(false)));
    assert_eq!(payloads[1].1["prompt"], "Retype new password:");
    assert_eq!(payloads[1].1["previous"], json!(["New password:"]));

    // Registro: sin la contraseña, aprobado por ti.
    let e = &c.audit.list()[0];
    assert_eq!(e.status, AuditStatus::Ok);
    assert_eq!(e.approved_by.as_deref(), Some("tú: una vez"));
    let mem = serde_json::to_string(&c.audit.list()).unwrap();
    assert!(!mem.contains(LOGIN_PW), "{mem}");
}

#[tokio::test]
async fn escrita_y_la_misma_para_todas_pregunta_una_vez() {
    let c = passwd_core();
    set_replies(&c, vec![json!({ "password": "tecleada-123", "sameForAll": true })]);
    let out = run_pw(&c, "web-prod").await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(ui_kinds(&c), ["password-run"]);
    assert_eq!(written(&c), vec![b"tecleada-123\n".to_vec(); 2]);
    assert!(!out.text.contains("tecleada"), "{}", out.text);
}

#[tokio::test]
async fn siempre_pregunta_aunque_haya_aceptar_automaticamente() {
    let c = passwd_core();
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Session, super::super::audit::now_ms()).unwrap();
    set_answer(&c, Answer::Give(Decision::Always));
    let out = run_pw(&c, "web-prod").await;
    assert!(out.is_error && out.text.contains("no permitió"), "{}", out.text);
    assert_eq!(ui_kinds(&c), ["password-run"], "el diálogo sale igual");
    assert!(c.backend.password.commands.lock().unwrap().is_empty(), "no se ejecutó nada");
    assert!(c.config.get().remembered_of("s-full").is_empty());
    assert_eq!(c.audit.list()[0].status, AuditStatus::Denied);
}

#[tokio::test]
async fn reglas_de_acceso_como_run_command() {
    let c = passwd_core();
    set_replies(&c, vec![json!({ "source": "login" })]);
    for server in ["db-server", "vps-personal"] {
        let out = run_pw(&c, server).await;
        assert!(out.is_error, "{server}: {}", out.text);
    }
    assert!(ui_kinds(&c).is_empty(), "ni pregunta");
    assert!(c.backend.password.commands.lock().unwrap().is_empty());

    // Sin motivo, tampoco.
    let out = call(&c, "run_with_password", json!({ "server": "web-prod", "command": "passwd", "reason": " " })).await;
    assert!(out.is_error && out.text.contains("motivo"), "{}", out.text);
}

#[tokio::test]
async fn sin_guardada_no_se_ejecuta() {
    let c = passwd_core();
    set_replies(&c, vec![json!({ "source": "sudo" })]);
    let out = run_pw(&c, "web-prod").await;
    assert!(out.is_error && out.text.contains("no tiene esa contraseña guardada"), "{}", out.text);
    assert!(c.backend.password.commands.lock().unwrap().is_empty());
}

#[tokio::test]
async fn si_no_pide_nada_no_se_escribe() {
    let c = core();
    set_script(&c, &["hola\r\n", "\0"], &[]);
    set_replies(&c, vec![json!({ "password": "x-123456" })]);
    let out = run_pw(&c, "web-prod").await;
    assert!(!out.is_error && out.text.contains("no pidió ninguna contraseña"), "{}", out.text);
    assert!(written(&c).is_empty());
}

#[tokio::test]
async fn run_command_tapa_las_guardadas_largas() {
    let c = core();
    *c.backend.password.sudo.lock().unwrap() = Some("sudo-larga-9".into());
    *c.backend.password.login.lock().unwrap() = Some("abc".into());
    *c.backend.stdout.lock().unwrap() = "export PW=sudo-larga-9 y abc\n".into();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "cat notas" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains(&format!("PW={MASK} y abc")), "las cortas no se tapan: {}", out.text);
}

#[test]
fn ver_la_de_sudo_solo_se_anuncia_si_se_permite() {
    let names = |allow| server::tools_for(allow).into_iter().map(|t| t.name.to_string()).collect::<Vec<_>>();
    assert!(!names(false).contains(&"request_sudo_password".to_string()));
    assert!(names(false).contains(&"run_with_password".to_string()));
    assert!(names(true).contains(&"request_sudo_password".to_string()));
    let off = server::instructions_for(false);
    assert!(off.contains("Nunca") && off.contains("run_with_password") && !off.contains("request_sudo_password"), "{off}");
    assert!(server::instructions_for(true).contains("request_sudo_password"));
    let t = server::tools().into_iter().find(|t| t.name == "run_with_password").unwrap();
    let schema = serde_json::to_string(&t.input_schema).unwrap();
    assert!(schema.contains("\"reason\"") && schema.contains("\"prompt_hint\""), "{schema}");
}

#[tokio::test]
async fn upload_no_saca_llaves_privadas() {
    let dir = std::env::temp_dir().join(format!("sshorus-mcp-key-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let key = dir.join("id_servidor");
    std::fs::write(&key, "-----BEGIN OPENSSH PRIVATE KEY-----").unwrap();
    let mut mock = Mock::new();
    mock.data.servers[0].key_path = Some(key.display().to_string());
    let c = core_with(mock, config());
    for local in [key.display().to_string(), dir.display().to_string()] {
        let out = call(&c, "upload", json!({ "server": "web-prod", "local_paths": [local], "remote_dir": "/tmp" })).await;
        assert!(out.is_error && out.text.contains("llave privada"), "{}", out.text);
    }
    assert_eq!(asked(&c), 0, "ni pregunta");
    let _ = std::fs::remove_dir_all(&dir);
}
