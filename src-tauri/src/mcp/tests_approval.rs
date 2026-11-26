//! Pruebas con el motor simulado de `tests.rs`: aprobación, límites de salida, registro, plantillas
//! y diferencias.

use super::*;

// ───────────────────────── Aprobación ─────────────────────────

#[tokio::test]
async fn approval_once_deny_and_always() {
    let c = core();
    // Una vez.
    set_answer(&c, Answer::Give(Decision::Once));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "podman restart web" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("Código de salida: 0"));
    {
        let reqs = c.backend.asked.lock().unwrap();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].command, "podman restart web");
        assert_eq!(reqs[0].server_name, "web-prod");
        assert!(reqs[0].can_remember);
    }
    // Denegar.
    set_answer(&c, Answer::Give(Decision::Deny));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "touch /tmp/x" })).await;
    assert!(out.is_error && out.text.contains("denegó"), "{}", out.text);
    assert_eq!(ran(&c).len(), 1);
    // Siempre: la segunda vez ya no pregunta.
    set_answer(&c, Answer::Give(Decision::Always));
    call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    let before = asked(&c);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    assert!(!out.is_error);
    assert_eq!(asked(&c), before, "no debió preguntar otra vez");
    assert!(c.config.get().remembered_of("s-full").contains("run_command\nuptime"));
    // Otro comando distinto sí pregunta.
    call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime -p" })).await;
    assert_eq!(asked(&c), before + 1);

    let log = c.audit.list();
    let first = log.iter().rev().find(|e| e.detail == "podman restart web").unwrap();
    assert_eq!(first.approved_by.as_deref(), Some("tú: una vez"));
    assert_eq!(first.status, AuditStatus::Ok);
    let denied = log.iter().find(|e| e.detail == "touch /tmp/x").unwrap();
    assert_eq!(denied.status, AuditStatus::Denied);
    assert_eq!(denied.approved_by.as_deref(), Some("tú: denegado"));
    let remembered = log.iter().find(|e| e.detail == "uptime").unwrap();
    assert_eq!(remembered.approved_by.as_deref(), Some(policy::REMEMBERED));
}

#[tokio::test]
async fn dangerous_always_asks() {
    let c = core();
    set_answer(&c, Answer::Give(Decision::Always));
    for _ in 0..2 {
        let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo reboot" })).await;
        assert!(!out.is_error);
    }
    assert_eq!(asked(&c), 2, "lo peligroso pregunta siempre");
    let reqs = c.backend.asked.lock().unwrap().clone();
    assert!(!reqs[0].can_remember);
    assert!(reqs[0].danger.iter().any(|d| d.contains("sudo")));
    assert!(c.config.get().remembered_of("s-full").is_empty());
    // Del catálogo marcado como peligroso: también.
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "podman.prune" })).await;
    assert!(!out.is_error);
    assert_eq!(asked(&c), 3);
    assert!(!c.backend.asked.lock().unwrap()[2].can_remember);
}

#[tokio::test(start_paused = true)]
async fn approval_times_out_and_denies() {
    let c = core_with(Mock::new(), McpConfig { approval_timeout_secs: 30, ..config() });
    set_answer(&c, Answer::Never);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "touch /tmp/x" })).await;
    assert!(out.is_error);
    assert!(out.text.contains("Nadie respondió") && out.text.contains("30 s"), "{}", out.text);
    assert!(ran(&c).is_empty());
    let e = &c.audit.list()[0];
    assert_eq!(e.status, AuditStatus::Denied);
    assert_eq!(e.approved_by.as_deref(), Some("sin respuesta"));
}

#[tokio::test]
async fn catalog_vars_are_quoted_and_checked() {
    let c = core();
    let out = call(
        &c,
        "run_catalog_command",
        json!({ "server": "web-prod", "id": "podman.logs", "vars": { "contenedor": "web; rm -rf /" } }),
    )
    .await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(ran(&c), vec!["podman logs --tail 100 'web; rm -rf /'".to_string()]);
    // Lectura del catálogo: sin preguntar… salvo que el valor lo haga peligroso.
    assert_eq!(asked(&c), 1, "«rm -rf» en el comando final obliga a preguntar");
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "podman.logs", "vars": { "contenedor": "--help" } })).await;
    assert!(out.is_error && out.text.contains("«-»"));
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "podman.logs" })).await;
    assert!(out.is_error && out.text.contains("contenedor"), "{}", out.text);
}

#[tokio::test]
async fn interactive_commands_are_refused() {
    let c = core();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "tail -f /var/log/syslog" })).await;
    assert!(out.is_error && out.text.contains("interactivo"));
    assert_eq!(asked(&c), 0);
}

#[tokio::test]
async fn write_file_shows_diff() {
    let c = core();
    c.backend.files.lock().unwrap().insert("/etc/app.conf".into(), "a\nb\nc\n".into());
    let out = call(&c, "write_file", json!({ "server": "web-prod", "path": "/etc/app.conf", "content": "a\nB\nc\n" })).await;
    assert!(!out.is_error, "{}", out.text);
    let req = c.backend.asked.lock().unwrap()[0].clone();
    let d = req.diff.unwrap();
    assert!(d.contains("-b") && d.contains("+B"), "{d}");
    assert_eq!(c.backend.files.lock().unwrap()["/etc/app.conf"], "a\nB\nc\n");
    // Archivo nuevo.
    call(&c, "write_file", json!({ "server": "web-prod", "path": "/tmp/nuevo", "content": "hola" })).await;
    let d = c.backend.asked.lock().unwrap()[1].diff.clone().unwrap();
    assert!(d.starts_with("(archivo nuevo)") && d.contains("+hola"), "{d}");
}

#[tokio::test]
async fn connect_opens_tab_with_permission() {
    let c = core();
    // Ya conectado: no pregunta.
    let out = call(&c, "connect", json!({ "server": "web-prod" })).await;
    assert!(out.text.contains("ss-full"));
    assert_eq!(asked(&c), 0);
    // Sin conexión: pregunta y pide a la interfaz que abra la pestaña.
    let mut m = Mock::new();
    m.sessions.clear();
    let c = core_with(m, config());
    let out = call(&c, "connect", json!({ "server": "db-server" })).await;
    assert!(!out.is_error && out.text.contains("nueva"), "{}", out.text);
    assert_eq!(asked(&c), 1);
    assert_eq!(c.backend.ui_calls.lock().unwrap().as_slice(), ["connect"]);
    // Sin conexión, el resto de herramientas lo dice claro.
    let out = call(&c, "list_dir", json!({ "server": "db-server", "path": "/" })).await;
    assert!(out.is_error && out.text.contains("connect"), "{}", out.text);
}

#[tokio::test]
async fn transfers_need_permission() {
    let c = core();
    let here = std::env::temp_dir().display().to_string();
    // Subir a un servidor de solo lectura: no.
    let out = call(&c, "upload", json!({ "server": "db-server", "local_paths": [here], "remote_dir": "/tmp" })).await;
    assert!(out.is_error && out.text.contains("solo lectura"), "{}", out.text);
    // Descargar desde solo lectura: sí, con permiso.
    let out = call(&c, "download", json!({ "server": "db-server", "remote_paths": ["/etc/hosts"], "local_dir": here })).await;
    assert!(!out.is_error && out.text.contains("lote-2"), "{}", out.text);
    assert_eq!(asked(&c), 1);
    // Rutas locales que no existen o relativas: error claro, sin preguntar.
    let out = call(&c, "upload", json!({ "server": "web-prod", "local_paths": ["no/existe"], "remote_dir": "/tmp" })).await;
    assert!(out.is_error && out.text.contains("No existe"), "{}", out.text);
    let out = call(&c, "download", json!({ "server": "web-prod", "remote_paths": ["/x"], "local_dir": "relativa" })).await;
    assert!(out.is_error);
    assert_eq!(asked(&c), 1);
    // Subir a completo: pregunta mostrando los archivos.
    let out = call(&c, "upload", json!({ "server": "web-prod", "local_paths": [here], "remote_dir": "/srv" })).await;
    assert!(!out.is_error && out.text.contains("lote-1"));
    let req = c.backend.asked.lock().unwrap()[1].clone();
    assert!(req.command.contains("/srv") && req.command.contains(&here), "{}", req.command);
}

// ───────────────────────── Límites ─────────────────────────

#[tokio::test]
async fn output_is_limited() {
    let c = core();
    *c.backend.stdout.lock().unwrap() = format!("INICIO{}FINAL", "x".repeat(300 * 1024));
    set_answer(&c, Answer::Give(Decision::Once));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "cat big", "max_output_kb": 4 })).await;
    assert!(!out.is_error);
    assert!(out.text.len() < 6 * 1024, "{}", out.text.len());
    assert!(out.text.contains("salida recortada"));
    assert!(out.text.contains("INICIO") && out.text.contains("FINAL") && out.text.contains("se omitieron"));
    // Por defecto: 64 KB.
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "cat big" })).await;
    assert!(out.text.len() < 66 * 1024 && out.text.len() > 60 * 1024);
}

#[test]
fn clip_middle_respects_chars() {
    let s = "ñ".repeat(1000);
    let out = crate::mcp::core::clip_middle(&s, 101);
    assert!(out.contains("se omitieron"));
    assert!(out.starts_with('ñ') && out.ends_with('ñ'));
}

#[tokio::test]
async fn read_file_is_chunked() {
    let c = core();
    c.backend.files.lock().unwrap().insert("/var/log/app.log".into(), "0123456789".repeat(10));
    let out = call(&c, "read_file", json!({ "server": "db-server", "path": "/var/log/app.log", "max_bytes": 30 })).await;
    assert!(!out.is_error);
    assert!(out.text.contains("100 bytes en total") && out.text.contains("offset=30"), "{}", out.text);
    c.backend.files.lock().unwrap().insert("/bin/x".into(), "\0ELF".into());
    let out = call(&c, "read_file", json!({ "server": "db-server", "path": "/bin/x" })).await;
    assert!(out.text.contains("binario"));
}

// ───────────────────────── Registro ─────────────────────────

#[tokio::test]
async fn audit_file_and_rotation() {
    let dir = std::env::temp_dir().join(format!("sshorus-mcp-audit-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(crate::mcp::audit::FILE_NAME);
    {
        let c = McpCore::new(Mock::new(), McpConfigStore::in_memory(config()), AuditLog::at(Some(path.clone())));
        call(&c, "list_servers", json!({})).await;
        call(&c, "run_command", json!({ "server": "vps-personal", "command": "ls" })).await;
    }
    let text = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["tool"], "list_servers");
    assert_eq!(lines[0]["status"], "ok");
    assert_eq!(lines[1]["status"], "denied");
    assert_eq!(lines[1]["serverName"], "vps-personal");
    assert_eq!(lines[1]["detail"], "ls");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // Al volver a abrir, se cargan las últimas acciones.
    let log = AuditLog::at(Some(path.clone()));
    assert_eq!(log.list().len(), 2);
    // Rotación al pasar de 1 MiB.
    let big = "x".repeat(crate::mcp::audit::ROTATE_BYTES as usize);
    std::fs::write(&path, big).unwrap();
    let c = McpCore::new(Mock::new(), McpConfigStore::in_memory(config()), AuditLog::at(Some(path.clone())));
    call(&c, "list_servers", json!({})).await;
    assert!(dir.join(crate::mcp::audit::OLD_FILE_NAME).exists());
    assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

// ───────────────────────── Plantillas y diferencias ─────────────────────────

#[test]
fn template_rendering() {
    let mut v = BTreeMap::new();
    v.insert("c".to_string(), "mi web".to_string());
    assert_eq!(template::render("podman logs {{c}}", &v).unwrap(), "podman logs 'mi web'");
    assert_eq!(template::render("echo '{{c}}'", &v).unwrap(), "echo 'mi web'");
    v.insert("c".to_string(), "a\"$b".to_string());
    assert_eq!(template::render("echo \"{{c}}\"", &v).unwrap(), "echo \"a\\\"\\$b\"");
    // Plantillas Go no son variables.
    assert_eq!(template::render("podman ps --format '{{.Names}}'", &BTreeMap::new()).unwrap(), "podman ps --format '{{.Names}}'");
    assert_eq!(template::render("x {{n:5}}", &BTreeMap::new()).unwrap(), "x 5");
    assert!(template::render("x {{n}}", &BTreeMap::new()).is_err());
    let mut bad = BTreeMap::new();
    bad.insert("otra".to_string(), "1".to_string());
    assert!(template::render("x {{n:1}}", &bad).unwrap_err().contains("otra"));
    assert_eq!(template::parse_vars("{{a}} {{b:2}} {{a:1}}"), vec![("a".into(), Some("1".into())), ("b".into(), Some("2".into()))]);
}

#[test]
fn line_diff() {
    assert_eq!(diff::unified("a\n", "a\n"), "");
    let d = diff::unified("uno\ndos\ntres\n", "uno\nDOS\ntres\ncuatro\n");
    assert!(d.starts_with("@@ -1,3 +1,4 @@"), "{d}");
    assert!(d.contains("-dos\n+DOS") && d.contains("+cuatro"), "{d}");
}
