//! Pruebas con el motor simulado de `tests.rs`: reglas de permisos y comandos peligrosos, bloqueo,
//! apagado y acceso por servidor.

use super::*;

// ───────────────────────── Reglas ─────────────────────────

#[test]
fn policy_levels() {
    let empty = Default::default();
    let read = Action::read("list_dir");
    let change = Action::change("run_command\nls");
    let dl = Action::change_on_read("download");
    assert!(matches!(policy::decide("x", Access::None, &read, &empty), Verdict::Deny(_)));
    assert_eq!(policy::decide("x", Access::Read, &read, &empty), Verdict::Allow(policy::AUTO_READ));
    assert!(matches!(policy::decide("x", Access::Read, &change, &empty), Verdict::Deny(m) if m.contains("solo lectura")));
    assert_eq!(policy::decide("x", Access::Read, &dl, &empty), Verdict::Ask { can_remember: true });
    assert_eq!(policy::decide("x", Access::Full, &change, &empty), Verdict::Ask { can_remember: true });
    let mut remembered = std::collections::BTreeSet::new();
    remembered.insert("run_command\nls".to_string());
    assert_eq!(policy::decide("x", Access::Full, &change, &remembered), Verdict::Allow(policy::REMEMBERED));
    // Peligroso: aunque esté recordado, se pregunta y no se puede recordar.
    let mut rm = Action::change("run_command\nrm -rf /tmp/x").with_danger(policy::danger_reasons("rm -rf /tmp/x"));
    remembered.insert(rm.key.clone());
    assert_eq!(policy::decide("x", Access::Full, &rm, &remembered), Verdict::Ask { can_remember: false });
    rm.danger.clear();
    assert_eq!(policy::decide("x", Access::Full, &rm, &remembered), Verdict::Allow(policy::REMEMBERED));
}

#[test]
fn dangerous_commands() {
    for c in [
        "rm -rf /var/www",
        "cd /x && rm -fr build",
        "podman system prune -af",
        "docker image prune",
        "sudo systemctl restart nginx",
        "reboot",
        "shutdown -h now",
        "doas apk add x",
        "su - root",
        "echo hola | sudo tee /etc/x",
        "mkfs.ext4 /dev/sdb1",
        "dd if=/dev/zero of=/dev/sda",
        "psql -c 'DROP TABLE users'",
        "git push --force",
    ] {
        assert!(!policy::danger_reasons(c).is_empty(), "debería ser peligroso: {c}");
    }
    for c in ["ls -la", "df -h", "podman ps -a", "cat /etc/os-release", "systemctl status nginx", "grep -r sudoers /tmp"] {
        assert!(policy::danger_reasons(c).is_empty(), "no debería ser peligroso: {c} → {:?}", policy::danger_reasons(c));
    }
    assert_eq!(policy::danger_reasons("rm -rf x"), vec!["borrado recursivo (rm -rf)".to_string()]);
    assert!(policy::looks_interactive("top"));
    assert!(policy::looks_interactive("tail -f /var/log/syslog"));
    assert!(!policy::looks_interactive("tail -n 50 /var/log/syslog"));
}

// ───────────────────────── Bloqueo, apagado y acceso ─────────────────────────

#[tokio::test]
async fn locked_rejects_everything() {
    let c = core();
    c.backend.locked.store(true, Ordering::SeqCst);
    for (tool, args) in [
        ("list_servers", json!({})),
        ("list_sessions", json!({})),
        ("run_command", json!({ "server": "web-prod", "command": "ls" })),
        ("read_file", json!({ "server": "web-prod", "path": "/etc/hosts" })),
    ] {
        let out = call(&c, tool, args).await;
        assert!(out.is_error, "{tool}");
        assert_eq!(out.text, LOCKED_MSG);
    }
    assert!(ran(&c).is_empty());
    assert_eq!(asked(&c), 0);
    let log = c.audit.list();
    assert_eq!(log.len(), 4);
    assert!(log.iter().all(|e| e.status == AuditStatus::Locked));
}

#[tokio::test]
async fn locked_while_waiting_for_approval() {
    // El usuario aprueba, pero SSHorus se bloqueó mientras esperaba: no se ejecuta.
    let c = core();
    c.backend.lock_on_ask.store(true, Ordering::SeqCst);
    set_answer(&c, Answer::Give(Decision::Once));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "touch x" })).await;
    assert_eq!(asked(&c), 1);
    assert!(out.is_error);
    assert_eq!(out.text, LOCKED_MSG);
    assert!(ran(&c).is_empty());
}

#[tokio::test]
async fn disabled_rejects_everything() {
    let c = core_with(Mock::new(), McpConfig { enabled: false, ..config() });
    let out = call(&c, "list_servers", json!({})).await;
    assert!(out.is_error);
    assert_eq!(out.text, DISABLED_MSG);
}

#[tokio::test]
async fn no_access_server_is_hidden_and_denied() {
    let c = core();
    let out = call(&c, "list_servers", json!({})).await;
    assert!(!out.is_error);
    assert!(out.text.contains("web-prod") && out.text.contains("db-server"));
    assert!(!out.text.contains("vps-personal"), "{}", out.text);
    let projects = call(&c, "list_projects", json!({})).await.text;
    assert!(projects.contains("web-prod") && !projects.contains("vps-personal"));
    let sessions = call(&c, "list_sessions", json!({})).await.text;
    assert!(!sessions.contains("ss-none"));

    for (tool, args) in [
        ("run_command", json!({ "server": "vps-personal", "command": "ls" })),
        ("list_dir", json!({ "server": "vps-personal", "path": "/" })),
        ("read_file", json!({ "server": "s-none", "path": "/etc/hosts" })),
        ("connect", json!({ "server": "vps-personal" })),
    ] {
        let out = call(&c, tool, args).await;
        assert!(out.is_error, "{tool}");
        assert!(out.text.contains("no tiene acceso"), "{tool}: {}", out.text);
    }
    assert!(ran(&c).is_empty());
    assert_eq!(asked(&c), 0);
    assert!(c.audit.list().iter().filter(|e| e.server_id.as_deref() == Some("s-none")).all(|e| e.status == AuditStatus::Denied));
}

#[tokio::test]
async fn read_only_server() {
    let c = core();
    // Lecturas: pasan sin preguntar.
    let out = call(&c, "list_dir", json!({ "server": "db-server", "path": "/etc" })).await;
    assert!(!out.is_error, "{}", out.text);
    let out = call(&c, "run_catalog_command", json!({ "server": "db-server", "id": "podman.ps" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(ran(&c), vec!["podman ps -a".to_string()]);
    let out = call(&c, "list_ports", json!({ "server": "db-server" })).await;
    assert!(!out.is_error && out.text.contains("\"port\": 22"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    // Cambios: rechazados sin preguntar.
    for (tool, args) in [
        ("run_command", json!({ "server": "db-server", "command": "ls" })),
        ("run_catalog_command", json!({ "server": "db-server", "id": "podman.restart", "vars": { "contenedor": "web" } })),
        ("write_file", json!({ "server": "db-server", "path": "/tmp/a", "content": "x" })),
    ] {
        let out = call(&c, tool, args).await;
        assert!(out.is_error && out.text.contains("solo lectura"), "{tool}: {}", out.text);
    }
    assert_eq!(asked(&c), 0);
    assert_eq!(ran(&c).len(), 1);
}
