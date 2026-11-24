//! Pruebas de sudo con el motor simulado de `tests.rs`: `request_sudo_password` (la IA pide la contraseña,
//! siempre con permiso) y los arreglos del sudo de `run_command` (sin sudo, root, bloqueo mientras espera,
//! mensajes para la IA).

use super::*;
use crate::mcp::core::AutoDuration;
use crate::mcp::policy::AutoLevel;

/// Configuración de prueba con «La IA puede pedir ver la contraseña de sudo» encendido.
fn reveal_config() -> McpConfig {
    let mut cfg = config();
    cfg.allow_sudo_reveal = true;
    cfg
}

fn reveal_core() -> McpCore<Mock> {
    let c = core_with(Mock::new(), reveal_config());
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": true, "password": SUDO_PW });
    c
}

async fn reveal(c: &McpCore<Mock>, server: &str) -> ToolOutput {
    call(c, "request_sudo_password", json!({ "server": server, "reason": "  instalar   un paquete\ncon su propio instalador " })).await
}

#[tokio::test]
async fn reveal_approved_gives_the_password_and_logs_without_it() {
    let dir = std::env::temp_dir().join(format!("sshorus-mcp-reveal-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(super::super::audit::FILE_NAME);
    let mock = Mock::new();
    *mock.sudo_reply.lock().unwrap() = json!({ "elevate": true, "password": SUDO_PW });
    let c = McpCore::new(mock, McpConfigStore::in_memory(reveal_config()), AuditLog::at(Some(path.clone())));

    let out = reveal(&c, "web-prod").await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains(SUDO_PW), "{}", out.text);

    // Diálogo propio: el motivo tal cual (limpio), el aviso y sin «Permitir siempre».
    let reqs = c.backend.asked.lock().unwrap().clone();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].tool, "request_sudo_password");
    assert_eq!(reqs[0].command, "instalar un paquete con su propio instalador");
    assert!(!reqs[0].can_remember);
    assert!(reqs[0].danger.iter().any(|d| d.contains("quedará en la conversación con la IA")), "{:?}", reqs[0].danger);

    // Después, la contraseña sale de la interfaz (guardada, memoria o diálogo) con el motivo.
    assert_eq!(ui_kinds(&c), ["sudo-reveal"]);
    let (_, payload) = c.backend.ui_payloads.lock().unwrap()[0].clone();
    assert_eq!(payload["sessionId"], "ss-full");
    assert_eq!(payload["profileId"], "s-full");
    assert_eq!(payload["reason"], "instalar un paquete con su propio instalador");
    assert!(ran(&c).is_empty(), "no ejecuta nada");

    // Registro (memoria y archivo): motivo y resultado, nunca la contraseña.
    let e = &c.audit.list()[0];
    assert_eq!(e.status, AuditStatus::Ok);
    assert_eq!(e.approved_by.as_deref(), Some("tú: una vez"));
    assert!(e.detail.contains("instalar un paquete"), "{}", e.detail);
    let mem = serde_json::to_string(&c.audit.list()).unwrap();
    assert!(!mem.contains("s3cr3t"), "{mem}");
    drop(c);
    let file = std::fs::read_to_string(&path).unwrap();
    assert!(file.contains("request_sudo_password"), "{file}");
    assert!(!file.contains("s3cr3t"), "{file}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn reveal_denied_never_asks_the_ui() {
    let c = reveal_core();
    set_answer(&c, Answer::Give(Decision::Deny));
    let out = reveal(&c, "web-prod").await;
    assert!(out.is_error);
    assert!(out.text.contains("no quiso") && out.text.contains("run_command"), "{}", out.text);
    assert!(ui_kinds(&c).is_empty());
    assert_eq!(c.audit.list()[0].status, AuditStatus::Denied);
    assert!(!out.text.contains("s3cr3t"));
}

#[tokio::test(start_paused = true)]
async fn reveal_without_answer_is_denied() {
    let c = reveal_core();
    set_answer(&c, Answer::Never);
    let out = reveal(&c, "web-prod").await;
    assert!(out.is_error);
    assert!(out.text.contains("Nadie respondió"), "{}", out.text);
    assert!(ui_kinds(&c).is_empty());
    assert_eq!(c.audit.list()[0].approved_by.as_deref(), Some("sin respuesta"));
}

#[tokio::test]
async fn reveal_and_lock() {
    // Ya bloqueado: ni pregunta.
    let c = reveal_core();
    c.backend.locked.store(true, Ordering::SeqCst);
    assert_eq!(reveal(&c, "web-prod").await.text, LOCKED_MSG);
    assert_eq!(asked(&c), 0);

    // Se bloquea mientras espera el permiso: nada, aunque se permita.
    let c = reveal_core();
    c.backend.lock_on_ask.store(true, Ordering::SeqCst);
    assert_eq!(reveal(&c, "web-prod").await.text, LOCKED_MSG);
    assert!(ui_kinds(&c).is_empty());

    // Se bloquea mientras se busca la contraseña: no se entrega.
    let c = reveal_core();
    c.backend.lock_on_sudo.store(true, Ordering::SeqCst);
    let out = reveal(&c, "web-prod").await;
    assert_eq!(out.text, LOCKED_MSG);
    assert_eq!(c.audit.list()[0].status, AuditStatus::Locked);
}

#[tokio::test(start_paused = true)]
async fn lock_while_waiting_ends_the_wait_at_once() {
    // Sin respuesta y SSHorus se bloquea al rato: se corta ya (no espera al tiempo límite).
    let c = Arc::new(reveal_core());
    set_answer(&c, Answer::Never);
    let c2 = c.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        c2.backend.locked.store(true, Ordering::SeqCst);
    });
    let started = tokio::time::Instant::now();
    let out = reveal(&c, "web-prod").await;
    assert_eq!(out.text, LOCKED_MSG);
    assert!(started.elapsed() < Duration::from_secs(10), "{:?}", started.elapsed());
}

#[tokio::test]
async fn reveal_only_with_full_access() {
    let c = reveal_core();
    let out = reveal(&c, "db-server").await;
    assert!(out.is_error);
    assert!(out.text.contains("acceso Completo") && out.text.contains("solo lectura"), "{}", out.text);
    let out = reveal(&c, "vps-personal").await;
    assert!(out.is_error && out.text.contains("no tiene acceso"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    assert!(ui_kinds(&c).is_empty());
    assert!(c.audit.list().iter().all(|e| e.status == AuditStatus::Denied));
}

#[tokio::test]
async fn reveal_setting_off() {
    let c = core_with(Mock::new(), config());
    let out = reveal(&c, "web-prod").await;
    assert!(out.is_error);
    assert!(out.text.contains("no permite") && out.text.contains("run_command"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    // Apagado por defecto. Un mcp.json viejo con el campo de antes (encendido por defecto) queda apagado;
    // el nuevo sí se respeta.
    assert!(!McpConfig::default().allow_sudo_reveal);
    let old: McpConfig = serde_json::from_value(json!({ "enabled": true, "allowSudoPasswordRequest": true })).unwrap();
    assert!(!old.allow_sudo_reveal);
    let new: McpConfig = serde_json::from_value(json!({ "allowSudoReveal": true })).unwrap();
    assert!(new.allow_sudo_reveal);
}

#[tokio::test]
async fn auto_accept_and_rules_never_skip_the_dialog() {
    let c = reveal_core();
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Session, super::super::audit::now_ms()).unwrap();
    // «Permitir siempre» no existe aquí: aunque llegue, no se guarda ninguna regla.
    set_answer(&c, Answer::Give(Decision::Always));
    for _ in 0..2 {
        let out = reveal(&c, "web-prod").await;
        assert!(!out.is_error, "{}", out.text);
    }
    assert_eq!(asked(&c), 2, "pregunta cada vez");
    assert!(c.config.get().remembered_of("s-full").is_empty());
    assert!(c.audit.list().iter().all(|e| !e.auto));
}

#[tokio::test]
async fn reveal_not_needed_canceled_and_missing_bits() {
    let c = reveal_core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "root" });
    let out = reveal(&c, "web-prod").await;
    assert!(!out.is_error && out.text.contains("root"), "{}", out.text);

    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "nopasswd" });
    let out = reveal(&c, "web-prod").await;
    assert!(!out.is_error && out.text.contains("no pide contraseña"), "{}", out.text);

    *c.backend.sudo_reply.lock().unwrap() = json!({ "canceled": true });
    let out = reveal(&c, "web-prod").await;
    assert!(out.is_error && out.text.contains("no escribió"), "{}", out.text);
    assert_eq!(c.audit.list()[0].status, AuditStatus::Denied);

    // Sin motivo: ni pregunta.
    let before = asked(&c);
    let out = call(&c, "request_sudo_password", json!({ "server": "web-prod", "reason": "   " })).await;
    assert!(out.is_error && out.text.contains("motivo"), "{}", out.text);
    assert_eq!(asked(&c), before);
}

#[tokio::test]
async fn reveal_is_announced() {
    let tools = super::super::server::tools();
    let t = tools.iter().find(|t| t.name == "request_sudo_password").expect("falta la herramienta");
    let desc = t.description.as_deref().unwrap_or_default();
    assert!(desc.contains("run_command") && desc.contains("sin que la veas"), "{desc}");
    assert_eq!(t.annotations.as_ref().and_then(|a| a.read_only_hint), Some(false));
    let schema = serde_json::to_string(&t.input_schema).unwrap();
    assert!(schema.contains("\"reason\"") && schema.contains("\"server\""), "{schema}");
}

// ───────────── sudo de run_command: arreglos ─────────────

#[tokio::test]
async fn run_command_sudo_without_sudo_installed_is_clear() {
    let c = core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "no-sudo" });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.is_error);
    assert!(out.text.contains("no está instalado") && out.text.contains("No se ejecutó"), "{}", out.text);
    assert!(ran(&c).is_empty());
}

#[tokio::test]
async fn run_command_sudo_as_root_without_sudo_gets_a_hint() {
    let c = core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "root" });
    *c.backend.exec_result.lock().unwrap() = Some(ExecResult {
        stdout: String::new(),
        stderr: "sh: sudo: not found\n".into(),
        exit_code: Some(127),
        duration_ms: 1,
        truncated: false,
        timed_out: false,
    });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.text.contains("root") && out.text.contains("quita «sudo»"), "{}", out.text);
    assert_eq!(ran(&c), ["sudo whoami"]);

    // Detectado como «sin contraseña» pero sudo la pidió: se dice qué hacer.
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "nopasswd" });
    *c.backend.exec_result.lock().unwrap() = Some(ExecResult {
        stdout: String::new(),
        stderr: "sudo: a terminal is required to read the password\nsudo: a password is required\n".into(),
        exit_code: Some(1),
        duration_ms: 1,
        truncated: false,
        timed_out: false,
    });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.text.contains("reconecte"), "{}", out.text);
}

#[tokio::test]
async fn run_command_sudo_ui_error_says_it_did_not_run() {
    // La interfaz falla (p. ej. la pestaña se cerró): mensaje con contexto y sin ejecutar.
    let c = core();
    *c.backend.sudo_reply.lock().unwrap() = json!("no es un objeto");
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.is_error && out.text.contains("No se ejecutó el comando"), "{}", out.text);
    assert!(ran(&c).is_empty());

    // Cancelado: dice qué hacer.
    *c.backend.sudo_reply.lock().unwrap() = json!({ "canceled": true });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.text.contains("Contraseña de sudo") && out.text.contains("vuelve a intentarlo"), "{}", out.text);
}

#[tokio::test(start_paused = true)]
async fn run_command_lock_while_looking_for_the_password() {
    // La interfaz tarda (diálogo abierto) y SSHorus se bloquea: se corta ya y no se ejecuta.
    let c = Arc::new(core());
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": true, "password": SUDO_PW });
    c.backend.sudo_delay.store(true, Ordering::SeqCst);
    let c2 = c.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        c2.backend.locked.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(1)).await;
        // Se desbloquea antes de que la interfaz conteste: igualmente no se ejecuta.
        c2.backend.locked.store(false, Ordering::SeqCst);
    });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert_eq!(out.text, LOCKED_MSG);
    assert!(ran(&c).is_empty());
}
