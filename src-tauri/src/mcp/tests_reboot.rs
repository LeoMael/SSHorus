//! Pruebas de `reboot_server`: permisos, aviso `expect_reboot`, sudo (root, sin contraseña,
//! contraseña con FakeSudo) y desarmado si falla o se cancela.

use super::*;
use crate::mcp::grants::{Grants, Task};

fn reboot_core() -> McpCore<Mock> {
    let c = core();
    *c.backend.stdout.lock().unwrap() = "@@sent\n".into();
    c
}

#[tokio::test]
async fn reboot_server_respects_access_and_always_asks() {
    let c = reboot_core();
    // Solo lectura: denegado sin preguntar ni avisar reinicio.
    let out = call(&c, "reboot_server", json!({ "server": "db-server" })).await;
    assert!(out.is_error && out.text.contains("solo lectura"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    assert!(c.backend.reboot_expects.lock().unwrap().is_empty());

    // Solo lo marcado sin comandos libres: denegado.
    c.config
        .update(|cfg| {
            cfg.access.insert("s-full".into(), Access::Custom);
            cfg.grants.insert(
                "s-full".into(),
                Grants { tasks: [Task::Services].into_iter().collect(), folders: vec![], free_commands: false },
            );
        })
        .unwrap();
    let out = call(&c, "reboot_server", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("Comandos libres"), "{}", out.text);
    assert_eq!(asked(&c), 0);

    // Acceso completo: pregunta siempre (sin «Permitir siempre»), incluso si el usuario dice Always.
    c.config
        .update(|cfg| {
            cfg.access.insert("s-full".into(), Access::Full);
        })
        .unwrap();
    set_answer(&c, Answer::Give(Decision::Always));
    for _ in 0..2 {
        let out = call(&c, "reboot_server", json!({ "server": "web-prod", "reason": "nuevo kernel" })).await;
        assert!(!out.is_error, "{}", out.text);
    }
    assert_eq!(asked(&c), 2);
    let req = c.backend.asked.lock().unwrap()[0].clone();
    assert!(!req.can_remember);
    assert!(req.command.contains("nuevo kernel"), "{}", req.command);
    assert!(req.danger.iter().any(|d| d.contains("reinicia")));
}

#[tokio::test]
async fn reboot_server_arms_expect_reboot_and_runs_as_root_or_sudo() {
    // Como root: no añade sudo y arma expect_reboot con el plazo acotado.
    let c = reboot_core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "root" });
    let out = call(&c, "reboot_server", json!({ "server": "web-prod", "wait_secs": 120 })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("120 s") && out.text.contains("1 conexión avisada"), "{}", out.text);
    assert_eq!(*c.backend.reboot_expects.lock().unwrap(), vec![("ss-full".into(), 120)]);
    let cmds = ran(&c);
    assert_eq!(cmds.len(), 1);
    assert!(!cmds[0].starts_with("sudo "), "como root no usa sudo: {}", cmds[0]);
    assert!(cmds[0].contains("@@sent"));

    // Sin contraseña (sudo nopasswd): usa sudo y acota wait_secs > MAX_WAIT_SECS.
    let c = reboot_core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": false, "why": "nopasswd" });
    let out = call(&c, "reboot_server", json!({ "server": "web-prod", "wait_secs": 9999 })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(*c.backend.reboot_expects.lock().unwrap(), vec![("ss-full".into(), 900)]);
    assert!(ran(&c)[0].starts_with("sudo "));
}

#[tokio::test]
async fn reboot_server_disarms_expect_reboot_on_failure_and_handles_sudo_cancel() {
    // Sudo cancelado: ni siquiera arma expect_reboot.
    let c = reboot_core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "canceled": true });
    let out = call(&c, "reboot_server", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("contraseña de sudo"), "{}", out.text);
    assert!(c.backend.reboot_expects.lock().unwrap().is_empty());
    assert!(ran(&c).is_empty());

    // El servidor no confirma @@sent: se desarma expect_reboot(0).
    let c = core();
    *c.backend.stdout.lock().unwrap() = String::new();
    let out = call(&c, "reboot_server", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("no confirmó"), "{}", out.text);
    assert_eq!(
        *c.backend.reboot_expects.lock().unwrap(),
        vec![("ss-full".into(), 300), ("ss-full".into(), 0)]
    );

    // Contraseña de sudo rechazada: notifica sudo-rejected y desarma expect_reboot(0).
    let c = core();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": true, "password": SUDO_PW });
    *c.backend.exec_result.lock().unwrap() = Some(ExecResult {
        stdout: String::new(),
        stderr: "__TV_SUDO_BAD__\n".into(),
        exit_code: Some(97),
        duration_ms: 5,
        truncated: false,
        timed_out: false,
    });
    let out = call(&c, "reboot_server", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("rechazó"), "{}", out.text);
    assert_eq!(
        *c.backend.reboot_expects.lock().unwrap(),
        vec![("ss-full".into(), 300), ("ss-full".into(), 0)]
    );
    assert!(ui_kinds(&c).contains(&"sudo-rejected".to_string()));
}
