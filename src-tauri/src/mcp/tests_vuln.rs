//! Pruebas con el motor simulado de `tests.rs`: herramientas de vulnerabilidades y auditoría del
//! servidor.

use super::*;

// ───────────────────────── Vulnerabilidades ─────────────────────────

fn scans(core: &McpCore<Mock>) -> usize {
    core.backend.scans.lock().unwrap().len()
}

#[tokio::test]
async fn vuln_report_is_a_read_with_access_rules() {
    let core = core();
    // Sin informe: no es un error; dice cómo conseguir uno. No pregunta nada (es lectura).
    let out = call(&core, "get_vuln_report", json!({ "server": "db-server" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("no tiene ningún análisis") && out.text.contains("scan_vulnerabilities"), "{}", out.text);

    let mut r = vuln_fixtures::report(
        (0..30).map(|i| vuln_fixtures::finding(&format!("CVE-2024-{i:04}"), Severity::High, true, Some(7.5))).collect(),
    );
    r.summary.high = 30;
    core.backend.vuln_saved.lock().unwrap().insert("s-read".into(), r);
    let out = call(&core, "get_vuln_report", json!({ "server": "db-server", "limit": 5 })).await;
    assert!(!out.is_error, "{}", out.text);
    let v: Value = serde_json::from_str(&out.text).unwrap();
    assert_eq!(v["server"], "db-server");
    assert_eq!(v["summary"]["high"], 30);
    assert_eq!(v["topFindings"].as_array().unwrap().len(), 5, "resumido, no el informe entero");
    assert_eq!(v["of"], 30);
    assert_eq!(asked(&core), 0);
    // No necesita conexión: lee el historial de este PC.
    let no_sessions = Mock { sessions: vec![], ..Mock::new() };
    no_sessions.vuln_saved.lock().unwrap().insert("s-full".into(), vuln_fixtures::report(vec![]));
    let core2 = core_with(no_sessions, config());
    let out = call(&core2, "get_vuln_report", json!({ "server": "web-prod" })).await;
    assert!(!out.is_error, "{}", out.text);

    // Sin acceso: rechazado y sin leer nada.
    let out = call(&core, "get_vuln_report", json!({ "server": "vps-personal" })).await;
    assert!(out.is_error && out.text.contains("no tiene acceso"), "{}", out.text);
    let log = core.audit.list();
    assert!(log.iter().any(|e| e.tool == "get_vuln_report" && e.status == AuditStatus::Denied));
    assert!(log.iter().any(|e| e.tool == "get_vuln_report" && e.approved_by.as_deref() == Some(policy::AUTO_READ)));
}

#[tokio::test(start_paused = true)]
async fn vuln_scan_asks_once_then_always_even_read_only() {
    let core = core();
    core.backend.vuln_settings.lock().unwrap().use_osv = false;
    set_answer(&core, Answer::Give(Decision::Always));
    // Servidor de solo lectura: permitido, pero con permiso.
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "db-server" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&core), 1);
    let req = core.backend.asked.lock().unwrap()[0].clone();
    assert_eq!(req.tool, "scan_vulnerabilities");
    assert!(req.can_remember, "se ofrece «Permitir siempre»");
    assert!(req.command.contains("SIN sudo") && req.command.contains("deploy"), "{}", req.command);
    assert!(!req.command.contains("OSV"), "OSV apagado en Ajustes: no se menciona: {}", req.command);
    // Resumen: recuento y la lista principal.
    let v: Value = serde_json::from_str(&out.text).unwrap();
    assert_eq!(v["summary"]["critical"], 1);
    assert_eq!(v["topFindings"][0]["id"], "CVE-2024-0001");
    // Opciones: las de Ajustes, sin sudo, guardando el informe, con la conexión del servidor.
    let (sid, opts) = core.backend.scans.lock().unwrap()[0].clone();
    assert_eq!(sid, "ss-read");
    assert!(!opts.use_osv && opts.save && opts.server_id == "s-read");

    // Segunda vez: regla «siempre», sin preguntar.
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "db-server" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&core), 1);
    assert_eq!(scans(&core), 2);
    let log = core.audit.list();
    assert!(log.iter().any(|e| e.tool == "scan_vulnerabilities" && e.approved_by.as_deref() == Some(policy::REMEMBERED)));
    // Y queda como último informe.
    let out = call(&core, "get_vuln_report", json!({ "server": "db-server" })).await;
    assert!(out.text.contains("CVE-2024-0001"), "{}", out.text);
}

#[tokio::test]
async fn vuln_scan_denied_or_without_connection() {
    let core = core();
    set_answer(&core, Answer::Give(Decision::Deny));
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("denegó"), "{}", out.text);
    assert_eq!(scans(&core), 0);
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "vps-personal" })).await;
    assert!(out.is_error && out.text.contains("no tiene acceso"), "{}", out.text);

    let core = core_with(Mock { sessions: vec![], ..Mock::new() }, config());
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod" })).await;
    assert!(out.is_error && out.text.contains("connect"), "{}", out.text);
    assert_eq!(asked(&core), 0);
}

#[tokio::test(start_paused = true)]
async fn vuln_scan_has_a_time_limit() {
    let core = core();
    *core.backend.scan_takes.lock().unwrap() = Duration::from_secs(3600);
    // Por debajo del mínimo: se usan 60 s.
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod", "timeout_secs": 1 })).await;
    assert!(out.is_error && out.text.contains("pasó de 60 s") && out.text.contains("se detuvo"), "{}", out.text);
    assert!(core.backend.scan_stops.lock().unwrap().is_empty(), "el análisis se detuvo");
    assert!(core.backend.vuln_saved.lock().unwrap().is_empty());
    let last = core.audit.list().into_iter().find(|e| e.tool == "scan_vulnerabilities").unwrap();
    assert_eq!(last.status, AuditStatus::Error);
}

#[tokio::test(start_paused = true)]
async fn vuln_scan_cancel_and_one_at_a_time() {
    let core = core();
    *core.backend.scan_takes.lock().unwrap() = Duration::from_secs(300);
    let first = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod" }));
    let second = async {
        // Espera a que el primero esté analizando.
        while core.backend.scan_stops.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let busy = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod" })).await;
        // «Detener» del panel de actividad: cancel_exec con el exec_id del análisis.
        let id = core.backend.scan_stops.lock().unwrap().keys().next().cloned().unwrap();
        assert!(core.backend.cancel_exec(&id));
        busy
    };
    let (first, busy) = tokio::join!(first, second);
    assert!(busy.is_error && busy.text.contains("en curso"), "{}", busy.text);
    assert!(first.is_error && first.text.contains("Se canceló el análisis"), "{}", first.text);
    assert_eq!(scans(&core), 1);

    // El cliente cancela la petición: también se detiene.
    let ct = CancellationToken::new();
    let c2 = ct.clone();
    let (out, ()) = tokio::join!(
        core.call("scan_vulnerabilities", json!({ "server": "web-prod" }), None, ct),
        async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            c2.cancel();
        }
    );
    assert!(out.is_error && out.text.contains("Se canceló"), "{}", out.text);
    // Ya no está «en curso»: se puede volver a analizar.
    *core.backend.scan_takes.lock().unwrap() = Duration::from_secs(1);
    let out = call(&core, "scan_vulnerabilities", json!({ "server": "web-prod" })).await;
    assert!(!out.is_error, "{}", out.text);
}

#[test]
fn vuln_tools_are_announced_as_reads() {
    let tools = crate::mcp::server::tools();
    for name in ["get_vuln_report", "scan_vulnerabilities", "get_infra_map"] {
        let t = tools.iter().find(|t| t.name == name).unwrap_or_else(|| panic!("falta {name}"));
        assert_eq!(t.annotations.as_ref().and_then(|a| a.read_only_hint), Some(true), "{name}");
    }
    let reboot = tools.iter().find(|t| t.name == "reboot_server").expect("falta reboot_server");
    assert_eq!(reboot.annotations.as_ref().and_then(|a| a.read_only_hint), Some(false));
    assert_eq!(reboot.annotations.as_ref().and_then(|a| a.destructive_hint), Some(true));
    assert_eq!(tools.len(), 26);
}

// ───────────────────────── Auditoría del servidor ─────────────────────────


#[tokio::test]
async fn audit_report_is_a_read_and_run_audit_asks() {
    let core = core();
    let out = call(&core, "get_audit_report", json!({ "server": "db-server" })).await;
    assert!(!out.is_error && out.text.contains("run_audit"), "{}", out.text);
    core.backend.audit_saved.lock().unwrap().insert("s-read".into(), audit_fixture());
    let out = call(&core, "get_audit_report", json!({ "server": "db-server" })).await;
    let v: Value = serde_json::from_str(&out.text).unwrap();
    assert_eq!(v["score"], 64);
    assert_eq!(v["problems"].as_array().unwrap().len(), 2);
    // Lo grave primero, con su arreglo y lo afectado recortado.
    assert_eq!(v["problems"][0]["id"], "ssh.root");
    assert_eq!(v["problems"][0]["fix"]["command"], "echo arreglo");
    assert_eq!(v["problems"][0]["affected"].as_array().unwrap().len(), 10);
    assert_eq!(v["problems"][0]["moreAffected"], 15);
    assert_eq!(v["unchecked"].as_array().unwrap().len(), 1);
    assert_eq!(asked(&core), 0, "leer el informe no pide permiso");

    // run_audit pide permiso y lo hace la interfaz.
    let out = call(&core, "run_audit", json!({ "server": "db-server" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&core), 1);
    assert!(core.backend.ui_calls.lock().unwrap().iter().any(|k| k == "audit"));
    let v: Value = serde_json::from_str(&out.text).unwrap();
    assert_eq!(v["grade"], "D");
}
