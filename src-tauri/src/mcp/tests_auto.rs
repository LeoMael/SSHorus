//! Pruebas con el motor simulado de `tests.rs`: aceptar automáticamente (niveles, duración y uso
//! en las llamadas).

use super::*;

#[test]
fn auto_policy_levels() {
    let empty = Default::default();
    let normal = Action::change("run_command\nuptime");
    let danger = Action::change("run_command\nrm -rf /x").with_danger(policy::danger_reasons("rm -rf /x"));
    let sudo = Action::change("run_command\nsudo ls").with_danger(policy::danger_reasons("sudo ls"));
    let dl = Action::change_on_read("download");
    let read = Action::read("list_dir");
    let d = |acc, a: &Action, lvl| policy::decide_auto("x", acc, a, &empty, lvl);

    // Apagado: como siempre.
    assert_eq!(d(Access::Full, &normal, AutoLevel::Off), Verdict::Ask { can_remember: true });
    assert_eq!(d(Access::Full, &danger, AutoLevel::Off), Verdict::Ask { can_remember: false });
    assert_eq!(d(Access::Full, &sudo, AutoLevel::Off), Verdict::Ask { can_remember: false });
    // Cambios normales: lo normal pasa; lo peligroso y sudo se siguen preguntando.
    assert_eq!(d(Access::Full, &normal, AutoLevel::Changes), Verdict::AutoAllow { danger: false });
    assert_eq!(d(Access::Full, &danger, AutoLevel::Changes), Verdict::Ask { can_remember: false });
    assert_eq!(d(Access::Full, &sudo, AutoLevel::Changes), Verdict::Ask { can_remember: false });
    // Todo: también lo peligroso y sudo (marcado como peligroso).
    assert_eq!(d(Access::Full, &normal, AutoLevel::All), Verdict::AutoAllow { danger: false });
    assert_eq!(d(Access::Full, &danger, AutoLevel::All), Verdict::AutoAllow { danger: true });
    assert_eq!(d(Access::Full, &sudo, AutoLevel::All), Verdict::AutoAllow { danger: true });
    // Las lecturas siguen siendo «automático (lectura)».
    assert_eq!(d(Access::Full, &read, AutoLevel::All), Verdict::Allow(policy::AUTO_READ));
    // Solo lectura: los cambios se rechazan y lo que se permite se sigue preguntando.
    for lvl in [AutoLevel::Changes, AutoLevel::All] {
        for a in [&normal, &danger, &sudo] {
            assert!(matches!(d(Access::Read, a, lvl), Verdict::Deny(m) if m.contains("solo lectura")));
        }
        assert_eq!(d(Access::Read, &dl, lvl), Verdict::Ask { can_remember: true });
        // Sin acceso: rechazado.
        assert!(matches!(d(Access::None, &normal, lvl), Verdict::Deny(_)));
        assert!(matches!(d(Access::None, &read, lvl), Verdict::Deny(_)));
    }
    // Una regla «siempre» sigue anotándose como regla.
    let remembered = ["run_command\nuptime".to_string()].into_iter().collect();
    assert_eq!(
        policy::decide_auto("x", Access::Full, &normal, &remembered, AutoLevel::Changes),
        Verdict::Allow(policy::REMEMBERED)
    );
}

#[test]
fn auto_effective_lock_access_and_expiry() {
    let now = 1_000_000;
    let temp = |level, until| Some(AutoGrant { level, until });
    let eff = policy::effective_auto;
    // Bloqueado o sin acceso Completo: nunca.
    assert_eq!(eff(Access::Full, true, Some(AutoLevel::All), temp(AutoLevel::All, None), now), AutoLevel::Off);
    assert_eq!(eff(Access::Read, false, Some(AutoLevel::All), temp(AutoLevel::All, None), now), AutoLevel::Off);
    assert_eq!(eff(Access::None, false, Some(AutoLevel::Changes), None, now), AutoLevel::Off);
    // Guardado («siempre»).
    assert_eq!(eff(Access::Full, false, Some(AutoLevel::Changes), None, now), AutoLevel::Changes);
    // Temporal: manda sobre el guardado mientras no caduque.
    assert_eq!(eff(Access::Full, false, Some(AutoLevel::Changes), temp(AutoLevel::All, Some(now + 1)), now), AutoLevel::All);
    assert_eq!(eff(Access::Full, false, None, temp(AutoLevel::All, Some(now)), now), AutoLevel::Off, "caducado");
    assert_eq!(eff(Access::Full, false, Some(AutoLevel::Changes), temp(AutoLevel::All, Some(now)), now), AutoLevel::Changes);
    // Hasta cerrar SSHorus: no caduca.
    assert_eq!(eff(Access::Full, false, None, temp(AutoLevel::Changes, None), u64::MAX - 1), AutoLevel::Changes);
}

#[tokio::test]
async fn auto_durations_with_simulated_clock() {
    let c = core();
    let t0 = 5_000_000;
    c.set_auto_at("s-full", AutoLevel::Changes, AutoDuration::Min15, t0).unwrap();
    assert_eq!(c.auto_level_at("s-full", t0 + 15 * 60 * 1000 - 1), AutoLevel::Changes);
    assert_eq!(c.auto_level_at("s-full", t0 + 15 * 60 * 1000), AutoLevel::Off, "15 min caducados");
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Hour, t0).unwrap();
    assert_eq!(c.auto_level_at("s-full", t0 + 59 * 60 * 1000), AutoLevel::All);
    assert_eq!(c.auto_level_at("s-full", t0 + 60 * 60 * 1000), AutoLevel::Off, "1 h caducada");
    assert!(c.auto_list_at(t0 + 60 * 60 * 1000).is_empty());
    // Lo temporal no se guarda en mcp.json.
    assert!(c.config.get().auto_accept.is_empty());
    c.set_auto_at("s-full", AutoLevel::Changes, AutoDuration::Session, t0).unwrap();
    assert_eq!(c.auto_level_at("s-full", u64::MAX - 1), AutoLevel::Changes);
    assert!(c.config.get().auto_accept.is_empty());
    // «Siempre»: en la configuración (y quita el temporal).
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Always, t0).unwrap();
    assert_eq!(c.config.get().auto_accept.get("s-full"), Some(&AutoLevel::All));
    let list = c.auto_list_at(t0);
    assert_eq!(list.len(), 1);
    assert!(list[0].saved && list[0].level == AutoLevel::All && list[0].server_name == "web-prod");
    // Bloqueado: no vale.
    c.backend.locked.store(true, Ordering::SeqCst);
    assert_eq!(c.auto_level_at("s-full", t0), AutoLevel::Off);
    c.backend.locked.store(false, Ordering::SeqCst);
    // Apagar: quita guardado y temporal.
    c.set_auto_at("s-full", AutoLevel::Off, AutoDuration::Always, t0).unwrap();
    assert!(c.config.get().auto_accept.is_empty());
    assert_eq!(c.auto_level_at("s-full", t0), AutoLevel::Off);
    c.set_auto_at("s-full", AutoLevel::Changes, AutoDuration::Session, t0).unwrap();
    c.auto_off_all().unwrap();
    assert!(c.auto_list_at(t0).is_empty());
    // Solo lectura y sin acceso: no se puede activar.
    assert!(c.set_auto_at("s-read", AutoLevel::Changes, AutoDuration::Session, t0).is_err());
    assert!(c.set_auto_at("s-none", AutoLevel::All, AutoDuration::Always, t0).is_err());
    // Si el servidor deja de tener acceso Completo (y ningún asistente lo tiene), no vale y se apaga.
    c.set_auto_at("s-full", AutoLevel::Changes, AutoDuration::Always, t0).unwrap();
    c.config
        .update(|cfg| {
            cfg.access.insert("s-full".into(), Access::Read);
        })
        .unwrap();
    assert_eq!(c.auto_level_at("s-full", t0), AutoLevel::Off);
    assert!(c.prune_auto_at(t0).unwrap());
    assert!(c.config.get().auto_accept.is_empty());
    assert!(!c.prune_auto_at(t0).unwrap());
}

#[tokio::test]
async fn auto_accept_in_calls() {
    let c = core();
    set_answer(&c, Answer::Give(Decision::Deny));
    // Cambios normales: no pregunta, queda marcado como automático.
    c.set_auto_at("s-full", AutoLevel::Changes, AutoDuration::Session, crate::mcp::audit::now_ms()).unwrap();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "podman restart web" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&c), 0);
    let e = c.audit.list().into_iter().find(|e| e.detail == "podman restart web").unwrap();
    assert!(e.auto && !e.auto_danger);
    assert_eq!(e.approved_by.as_deref(), Some(policy::AUTO_CHANGE));
    // Lo peligroso y sudo se siguen preguntando (y aquí se deniegan).
    for cmd in ["rm -rf /tmp/x", "sudo systemctl restart nginx"] {
        let out = call(&c, "run_command", json!({ "server": "web-prod", "command": cmd })).await;
        assert!(out.is_error && out.text.contains("denegó"), "{cmd}: {}", out.text);
    }
    assert_eq!(asked(&c), 2);
    // Solo lectura: sigue rechazando escrituras sin preguntar.
    let out = call(&c, "write_file", json!({ "server": "db-server", "path": "/tmp/a", "content": "x" })).await;
    assert!(out.is_error && out.text.contains("solo lectura"));
    assert_eq!(asked(&c), 2);

    // Todo: sudo y lo peligroso pasan solos, marcados como peligrosos.
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Session, crate::mcp::audit::now_ms()).unwrap();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo systemctl restart nginx" })).await;
    assert!(!out.is_error, "{}", out.text);
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "podman.prune" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&c), 2, "no debió preguntar");
    let log = c.audit.list();
    let e = log.iter().find(|e| e.detail.contains("sudo systemctl") && e.status == AuditStatus::Ok).unwrap();
    assert!(e.auto && e.auto_danger);
    assert_eq!(e.approved_by.as_deref(), Some(policy::AUTO_DANGER));
    // La petición de la contraseña a la interfaz dice que fue automático (y nunca lleva contraseña).
    let payloads = c.backend.ui_payloads.lock().unwrap().clone();
    let (_, p) = payloads.iter().rev().find(|(k, _)| k == "sudo").unwrap();
    assert_eq!(p["auto"], json!(true));
    // Nada se recordó como regla.
    assert!(c.config.get().remembered_of("s-full").is_empty());

    // Bloqueado: no se acepta nada (se rechaza todo).
    c.backend.locked.store(true, Ordering::SeqCst);
    let before = ran(&c).len();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "touch /tmp/y" })).await;
    assert!(out.is_error && out.text == LOCKED_MSG, "{}", out.text);
    assert_eq!(ran(&c).len(), before);
}
