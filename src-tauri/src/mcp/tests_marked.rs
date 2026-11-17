//! Pruebas de «Solo lo marcado» (casillas, carpetas, plantillas), usuarios protegidos y ajustes para varios
//! servidores, con el motor simulado de `tests.rs`.

use std::collections::BTreeSet;

use super::*;
use crate::mcp::core::AutoDuration;
use crate::mcp::grants::{self, Grants, Need, Task, Template};
use crate::mcp::policy::AutoLevel;
use crate::mcp::protect::{self, Protected};
use crate::mcp::rules::{self, Rules};

const PASSWD: &str = "root:x:0:0:root:/root:/bin/bash\nana:x:1001:1001:Ana:/home/ana:/bin/bash\n";

fn tasks(list: &[Task]) -> BTreeSet<Task> {
    list.iter().copied().collect()
}

fn cat(id: &str, command: &str, perm: Option<&str>, read_only: bool, sudo: bool) -> CatalogEntry {
    CatalogEntry {
        id: id.into(),
        category: "X".into(),
        name: id.into(),
        description: None,
        command: command.into(),
        dangerous: false,
        sudo,
        read_only,
        interactive: false,
        perm: perm.map(str::to_string),
        scope: None,
    }
}

/// «web-prod» (s-full) con «Solo lo marcado» y estas casillas.
fn marked(g: Grants) -> McpCore<Mock> {
    let mut cfg = config();
    cfg.access.insert("s-full".into(), Access::Custom);
    cfg.grants.insert("s-full".into(), g);
    let c = core_with(Mock::new(), cfg);
    c.set_catalog(vec![
        cat("usuarios.crear", "sudo useradd -m {{usuario}}", Some("users-create"), false, true),
        cat("usuarios.borrar", "sudo userdel {{usuario}}", Some("users-delete"), false, true),
        cat("usuarios.grupo", "usermod -aG {{grupo}} {{usuario}}", Some("users-edit"), false, false),
        cat("web.recargar", "sudo systemctl reload caddy", Some("web"), false, true),
        cat("podman.restart", "podman restart {{contenedor}}", Some("containers"), false, false),
        cat("git.pull", "git pull", None, false, false),
        cat("ver.uptime", "uptime", None, true, false),
    ]);
    c
}

fn grants_with(list: &[Task]) -> Grants {
    Grants { tasks: tasks(list), ..Default::default() }
}

fn last_danger(c: &McpCore<Mock>) -> (Vec<String>, bool) {
    let a = c.backend.asked.lock().unwrap();
    let r = a.last().expect("se esperaba una pregunta");
    (r.danger.clone(), r.can_remember)
}

// ───────────────────────── Reglas puras ─────────────────────────

#[test]
fn task_codes_and_templates() {
    for t in grants::ALL_TASKS {
        assert_eq!(Task::from_code(t.code()), Some(t));
        assert_eq!(serde_json::to_value(t).unwrap(), json!(t.code()));
    }
    assert_eq!(Task::from_code("inventada"), None);
    assert_eq!(Template::Users.tasks(), tasks(&[Task::UsersCreate, Task::UsersEdit, Task::UsersDelete]));
    assert_eq!(Template::Web.tasks(), tasks(&[Task::Web]));
    assert_eq!(
        Template::Deploy.tasks(),
        tasks(&[Task::UsersCreate, Task::UsersEdit, Task::UsersDelete, Task::Web, Task::Containers, Task::Services])
    );
    assert_eq!(Template::All.tasks().len(), grants::ALL_TASKS.len());
    // La plantilla deja las carpetas y apaga los comandos libres.
    let before = Grants { tasks: tasks(&[Task::Packages]), folders: vec!["/srv/www".into()], free_commands: true };
    let after = Template::Web.apply(&before);
    assert_eq!(after, Grants { tasks: tasks(&[Task::Web]), folders: vec!["/srv/www".into()], free_commands: false });
    assert_eq!(serde_json::from_value::<Template>(json!("deploy")).unwrap(), Template::Deploy);
}

#[test]
fn each_task_allowed_and_denied() {
    for t in grants::ALL_TASKS.into_iter().filter(|t| *t != Task::Files) {
        let only = grants_with(&[t]);
        assert_eq!(only.check("srv", &Need::Task(t)), Ok(()));
        for other in grants::ALL_TASKS.into_iter().filter(|o| *o != t && *o != Task::Files) {
            let msg = only.check("srv", &Need::Task(other)).unwrap_err();
            assert!(msg.contains(other.label()), "{msg}");
            assert!(msg.contains("Ajustes → Asistentes de IA"), "{msg}");
        }
        let free = only.check("srv", &Need::Free).unwrap_err();
        assert!(free.contains("Comandos libres") && free.contains(t.label()), "{free}");
    }
    assert_eq!(Grants::default().check("srv", &Need::Nothing), Ok(()));
}

#[test]
fn free_commands_lift_every_limit() {
    let g = Grants { free_commands: true, ..Default::default() };
    for need in [
        Need::Free,
        Need::Task(Task::UsersDelete),
        Need::Write { paths: vec!["/etc/x".into()], outside: vec!["/etc/x".into()] },
    ] {
        assert_eq!(g.check("srv", &need), Ok(()));
    }
}

#[test]
fn folders_and_paths() {
    assert_eq!(grants::normalize_abs("/srv//www/./a/../b/"), Some("/srv/www/b".into()));
    assert_eq!(grants::normalize_abs("/../.."), Some("/".into()));
    assert_eq!(grants::normalize_abs("srv"), None);
    assert!(grants::within("/srv/www", "/srv/www"));
    assert!(grants::within("/srv/www/", "/srv/www/site/index.html"));
    assert!(!grants::within("/srv/www", "/srv/www2/x"));
    assert!(!grants::within("/srv/www", "/srv/www/../etc/passwd"));
    assert!(grants::within("/", "/etc/passwd"));
    assert!(!grants::within("srv", "/srv"));
    let out = grants::outside(&["/srv/www/a".into(), "/etc/b".into()], &["/srv/www".into()]);
    assert_eq!(out, vec!["/etc/b".to_string()]);
    // Sanitize: relativas fuera, «..» resuelto, sin repetir.
    let g = Grants { folders: vec!["/srv/www/".into(), "rel".into(), "/srv/x/../www".into()], ..Default::default() }.sanitize();
    assert_eq!(g.folders, vec!["/srv/www".to_string()]);
    let files = grants_with(&[Task::Files]);
    let w = |outside: &[&str]| Need::Write { paths: vec![], outside: outside.iter().map(|s| s.to_string()).collect() };
    assert_eq!(files.check("srv", &w(&[])), Ok(()));
    assert!(files.check("srv", &w(&["/etc/x"])).unwrap_err().contains("/etc/x"));
    assert!(grants_with(&[Task::Web]).check("srv", &w(&[])).unwrap_err().contains("Archivos"));
}

#[test]
fn custom_level_and_auto_accept() {
    let g = grants_with(&[Task::Web]);
    let none = BTreeSet::new();
    let web = Action::change("run_command\nx").with_need(Need::Task(Task::Web));
    let users = Action::change("run_command\ny").with_need(Need::Task(Task::UsersCreate));
    let decide = |a: &Action, auto| policy::decide_rules("srv", Access::Custom, &g, a, &none, auto);
    assert_eq!(decide(&web, AutoLevel::Off), Verdict::Ask { can_remember: true });
    assert_eq!(decide(&web, AutoLevel::Changes), Verdict::AutoAllow { danger: false });
    // Fuera de lo marcado: rechazado aunque el modo automático sea «todo».
    assert!(matches!(decide(&users, AutoLevel::All), Verdict::Deny(_)));
    assert!(matches!(decide(&Action::change("run_command\nls"), AutoLevel::All), Verdict::Deny(_)));
    // Lecturas y cambios «de lectura» (conectar, descargar) pasan como en solo lectura.
    assert_eq!(decide(&Action::read("list_dir"), AutoLevel::Off), Verdict::Allow(policy::AUTO_READ));
    assert_eq!(decide(&Action::change_on_read("download"), AutoLevel::Off), Verdict::Ask { can_remember: true });
    // El modo automático vale con «Solo lo marcado»; no con solo lectura.
    assert_eq!(policy::effective_auto(Access::Custom, false, Some(AutoLevel::Changes), None, 0), AutoLevel::Changes);
    assert_eq!(policy::effective_auto(Access::Read, false, Some(AutoLevel::Changes), None, 0), AutoLevel::Off);
    assert_eq!(policy::effective_auto(Access::Custom, true, Some(AutoLevel::All), None, 0), AutoLevel::Off);
}

#[test]
fn old_mcp_json_still_loads() {
    let old = r#"{"enabled":true,"port":47821,"approvalTimeoutSecs":120,
        "access":{"a":"full","b":"read","c":"none"},
        "remembered":{"a":["run_command\nuptime"]},
        "autoAccept":{"a":"changes","b":"all"}}"#;
    let cfg: McpConfig = serde_json::from_str::<McpConfig>(old).unwrap().sanitize();
    assert_eq!(cfg.access_of("a"), Access::Full);
    assert_eq!(cfg.access_of("b"), Access::Read);
    assert_eq!(cfg.access_of("c"), Access::None);
    assert_eq!(cfg.auto_accept.get("a"), Some(&AutoLevel::Changes));
    assert!(!cfg.auto_accept.contains_key("b"));
    assert!(cfg.grants.is_empty() && cfg.protected_users.is_empty() && cfg.protected_global.is_empty());
    assert!(cfg.allow_sudo_password_request);

    // Lo nuevo se guarda y se vuelve a leer igual.
    let mut next = cfg.clone();
    next.access.insert("d".into(), Access::Custom);
    next.grants.insert("d".into(), Grants { tasks: tasks(&[Task::Files]), folders: vec!["/srv".into()], free_commands: false });
    next.auto_accept.insert("d".into(), AutoLevel::Changes);
    next.protected_global.insert("root".into());
    let text = serde_json::to_string(&next).unwrap();
    assert!(text.contains(r#""d":"custom""#), "{text}");
    let back: McpConfig = serde_json::from_str::<McpConfig>(&text).unwrap().sanitize();
    assert_eq!(back, next);
}

#[test]
fn protected_names_are_cleaned() {
    let mut cfg = McpConfig {
        protected_global: ["root".to_string(), " ".into(), "a b".into()].into_iter().collect(),
        ..Default::default()
    };
    cfg.protected_users.insert("s1".into(), ["ana".to_string(), "no-existe".into()].into_iter().collect());
    let cfg = cfg.sanitize();
    assert_eq!(cfg.protected_global, ["root".to_string()].into_iter().collect());
    let s1: Vec<String> = cfg.protected_of("s1").into_iter().collect();
    assert_eq!(s1, vec!["ana", "no-existe", "root"]);
    assert_eq!(cfg.protected_of("otro").len(), 1);
}

#[test]
fn rules_apply_to_several_servers() {
    let mut cfg = McpConfig::default();
    cfg.grants.insert("b".into(), Grants { folders: vec!["/srv".into()], ..Default::default() });
    let ids = vec!["a".to_string(), "b".into(), " ".into()];
    rules::apply(&mut cfg, &ids, &Rules { template: Some(Template::Deploy), ..Default::default() });
    for id in ["a", "b"] {
        assert_eq!(cfg.access_of(id), Access::Custom);
        assert_eq!(cfg.grants_of(id).tasks, Template::Deploy.tasks());
    }
    assert_eq!(cfg.grants_of("b").folders, vec!["/srv".to_string()]);
    assert!(!cfg.access.contains_key(" "));
    rules::apply(
        &mut cfg,
        &ids[..1],
        &Rules { access: Some(Access::Full), protected: Some(vec!["ana".into()]), ..Default::default() },
    );
    assert_eq!(cfg.access_of("a"), Access::Full);
    assert_eq!(cfg.grants_of("a").tasks, Template::Deploy.tasks(), "las casillas se conservan");
    assert!(cfg.protected_of("a").contains("ana") && !cfg.protected_of("b").contains("ana"));
    // Solo protegidos: no cambia el nivel.
    rules::apply(&mut cfg, &ids[1..2], &Rules { protected: Some(vec!["bob".into()]), ..Default::default() });
    assert_eq!(cfg.access_of("b"), Access::Custom);
}

#[test]
fn protected_detection() {
    let users = protect::resolve(&["ana".to_string(), "root".into(), "fantasma".into()].into_iter().collect(), PASSWD);
    assert_eq!(users[0], Protected { name: "ana".into(), uid: Some(1001), home: "/home/ana".into() });
    assert_eq!(users[1], Protected { name: "fantasma".into(), uid: None, home: "/home/fantasma".into() });
    assert_eq!(users[2].home, "/root");
    let m = |c: &str| protect::mentioned(c, &users);
    assert_eq!(m("ls /home/ana/.ssh"), vec!["ana"]);
    assert_eq!(m("cat ~ana/x"), vec!["ana"]);
    assert_eq!(m("chown 1001:1001 /srv/x"), vec!["ana"]);
    assert_eq!(m("passwd root"), vec!["root"]);
    assert!(m("chroot /mnt; ls /home/anabel; sleep 1001; echo banana").is_empty());
    let s = |c: &str| protect::switches_to(c, &users);
    assert_eq!(s("sudo -u ana podman ps"), vec!["ana"]);
    assert_eq!(s("sudo --user=ana id"), vec!["ana"]);
    assert_eq!(s("sudo -u#1001 id"), vec!["ana"]);
    assert_eq!(s("su - ana -c id"), vec!["ana"]);
    assert_eq!(s("runuser -u ana -- id"), vec!["ana"]);
    assert_eq!(s("systemctl --user -M ana@ restart web"), vec!["ana"]);
    assert_eq!(s("machinectl shell fantasma@"), vec!["fantasma"]);
    assert!(s("sudo -u www-data id; ls /home/ana").is_empty());
    let hit = protect::homes_hit(&["/home/ana/x".into()], &users, &[]);
    assert_eq!(hit, vec!["ana"]);
    let real = vec![("ana".to_string(), "/var/home/ana".to_string())];
    assert_eq!(protect::homes_hit(&["/var/home/ana/x".into()], &users, &real), vec!["ana"]);
    assert!(protect::homes_hit(&["/home/anabel/x".into()], &users, &[]).is_empty());
    assert_eq!(protect::clean_name(" ana "), Some("ana".into()));
    assert_eq!(protect::clean_name("a:b"), None);
}

// ───────────────────────── Con el motor simulado ─────────────────────────

#[tokio::test]
async fn run_command_needs_free_commands() {
    let c = marked(Template::Deploy.apply(&Grants::default()));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    assert!(out.is_error && out.text.contains("Comandos libres"), "{}", out.text);
    assert!(out.text.contains("Ajustes → Asistentes de IA"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    assert!(ran(&c).is_empty());

    let c = marked(Grants { free_commands: true, ..Default::default() });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&c), 1);
    // Con comandos libres las casillas ya no limitan.
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "git.pull" })).await;
    assert!(!out.is_error, "{}", out.text);
}

#[tokio::test]
async fn catalog_commands_by_task() {
    let c = marked(grants_with(&[Task::UsersCreate, Task::Containers]));
    let run = |id: &str, vars: Value| json!({ "server": "web-prod", "id": id, "vars": vars });
    let out = call(&c, "run_catalog_command", run("podman.restart", json!({ "contenedor": "web" }))).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(ran(&c), vec!["podman restart web"]);

    for (id, vars, label) in [
        ("usuarios.borrar", json!({ "usuario": "bob" }), "Usuarios: borrar"),
        ("usuarios.grupo", json!({ "usuario": "bob", "grupo": "web" }), "Usuarios: editar"),
        ("web.recargar", json!({}), "Sitios web"),
        ("git.pull", json!({}), "Comandos libres"),
    ] {
        let out = call(&c, "run_catalog_command", run(id, vars)).await;
        assert!(out.is_error && out.text.contains(label), "{id}: {}", out.text);
    }
    assert_eq!(ran(&c).len(), 1);
    assert_eq!(asked(&c), 1);
    // Las lecturas pasan sin casilla.
    let out = call(&c, "run_catalog_command", run("ver.uptime", json!({}))).await;
    assert!(!out.is_error && asked(&c) == 1, "{}", out.text);
    // list_catalog dice la tarea de cada comando.
    let out = call(&c, "list_catalog", json!({ "query": "useradd" })).await;
    assert!(out.text.contains(r#""permission":"users-create""#), "{}", out.text);
}

#[tokio::test]
async fn auto_accept_only_inside_marked() {
    let c = marked(grants_with(&[Task::Containers]));
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Session, 1).unwrap();
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "podman.restart", "vars": { "contenedor": "web" } })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&c), 0, "dentro de lo marcado pasa solo");
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "usuarios.crear", "vars": { "usuario": "bob" } })).await;
    assert!(out.is_error && out.text.contains("Usuarios: crear"), "{}", out.text);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    assert!(out.is_error, "{}", out.text);
    assert_eq!(ran(&c).len(), 1);
    // En solo lectura no se puede activar.
    assert!(c.set_auto_at("s-read", AutoLevel::Changes, AutoDuration::Session, 1).is_err());
    assert_eq!(c.auto_list_at(1).len(), 1);
}

#[tokio::test]
async fn write_only_inside_allowed_folders() {
    let g = Grants { tasks: tasks(&[Task::Files]), folders: vec!["/srv/www".into(), "/var/www".into()], free_commands: false };
    let c = marked(g);
    c.backend.links.lock().unwrap().extend([
        ("/srv/www/fuga".to_string(), "/etc".to_string()),
        ("/var/www".to_string(), "/data/web".to_string()),
    ]);
    let write = |path: &str| json!({ "server": "web-prod", "path": path, "content": "hola" });
    let out = call(&c, "write_file", write("/srv/www/index.html")).await;
    assert!(!out.is_error, "{}", out.text);
    for bad in ["/srv/www/../../etc/passwd", "/srv/www/fuga/passwd", "/etc/hosts", "notas.txt"] {
        let out = call(&c, "write_file", write(bad)).await;
        assert!(out.is_error && out.text.contains("fuera"), "{bad}: {}", out.text);
    }
    // La carpeta permitida es un enlace: vale su destino real.
    let out = call(&c, "write_file", write("/var/www/app/a.txt")).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(c.backend.files.lock().unwrap().contains_key("/var/www/app/a.txt"));
    assert_eq!(asked(&c), 2);

    let up = |dir: &str| json!({ "server": "web-prod", "local_paths": [env!("CARGO_MANIFEST_DIR")], "remote_dir": dir });
    assert!(!call(&c, "upload", up("/srv/www/sub")).await.is_error);
    let out = call(&c, "upload", up("/srv/www/fuga")).await;
    assert!(out.is_error && out.text.contains("/etc"), "{}", out.text);

    // Sin la casilla «Archivos», nada (y no se lee nada antes).
    let c = marked(grants_with(&[Task::Web]));
    let out = call(&c, "write_file", write("/srv/www/index.html")).await;
    assert!(out.is_error && out.text.contains("Archivos"), "{}", out.text);
    assert_eq!(asked(&c), 0);
}

#[tokio::test]
async fn list_servers_shows_tasks_and_protected() {
    let c = marked(Grants { tasks: tasks(&[Task::Web, Task::Files]), folders: vec!["/srv".into()], free_commands: false });
    c.config
        .update(|cfg| {
            cfg.protected_global.insert("root".into());
            cfg.protected_users.insert("s-full".into(), ["ana".to_string()].into_iter().collect());
        })
        .unwrap();
    let out = call(&c, "list_servers", json!({})).await;
    let list: Vec<Value> = serde_json::from_str(&out.text).unwrap();
    let web = list.iter().find(|s| s["id"] == "s-full").unwrap();
    assert_eq!(web["access"], "custom");
    assert_eq!(web["marked"]["tasks"], json!(["web", "files"]));
    assert_eq!(web["marked"]["folders"], json!(["/srv"]));
    assert_eq!(web["marked"]["freeCommands"], false);
    assert_eq!(web["protectedUsers"], json!(["ana", "root"]));
    let db = list.iter().find(|s| s["id"] == "s-read").unwrap();
    assert_eq!(db["marked"], Value::Null);
    assert_eq!(db["protectedUsers"], json!(["root"]));
}

fn protected_core() -> McpCore<Mock> {
    let c = core();
    *c.backend.stdout.lock().unwrap() = PASSWD.into();
    c.config
        .update(|cfg| {
            cfg.protected_global.insert("root".into());
            cfg.protected_users.insert("s-full".into(), ["ana".to_string(), "no-existe".into()].into_iter().collect());
        })
        .unwrap();
    c.set_catalog(vec![
        cat("usuarios.borrar", "sudo userdel {{usuario}}", Some("users-delete"), false, true),
        cat("usuarios.grupo", "usermod -aG {{grupo}} {{usuario}}", Some("users-edit"), false, false),
        cat("ver.id", "id {{usuario}}", None, true, false),
    ]);
    c
}

#[tokio::test]
async fn protected_users_high_level_is_refused() {
    let c = protected_core();
    for (vars, who) in [
        (json!({ "usuario": "ana" }), "ana"),
        (json!({ "usuario": "root" }), "root"),
        (json!({ "usuario": "no-existe" }), "no-existe"),
    ] {
        let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "usuarios.borrar", "vars": vars })).await;
        assert!(out.is_error && out.text.contains(&format!("«{who}»")) && out.text.contains("protegido"), "{}", out.text);
    }
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "usuarios.grupo", "vars": { "usuario": "bob", "grupo": "web" } })).await;
    assert!(!out.is_error, "{}", out.text);
    // Leer sí (según el nivel).
    let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "ver.id", "vars": { "usuario": "ana" } })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(asked(&c), 1);
    assert!(!ran(&c).iter().any(|r| r.contains("userdel")));
    // «sudo -u» a un protegido: rechazado, en cualquier nivel.
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo -u ana podman ps" })).await;
    assert!(out.is_error && out.text.contains("«ana»"), "{}", out.text);
    assert_eq!(asked(&c), 1);
}

#[tokio::test]
async fn protected_home_files() {
    let c = protected_core();
    *c.backend.files.lock().unwrap() = [("/home/ana/notas.txt".to_string(), "x".to_string())].into_iter().collect();
    c.backend.links.lock().unwrap().insert("/srv/atajo".into(), "/home/ana".into());
    for path in ["/home/ana/.bashrc", "/srv/atajo/x", "/home/deploy/../ana/y", "/root/.ssh/authorized_keys"] {
        let out = call(&c, "write_file", json!({ "server": "web-prod", "path": path, "content": "x" })).await;
        assert!(out.is_error && out.text.contains("protegido"), "{path}: {}", out.text);
    }
    let out = call(&c, "upload", json!({ "server": "web-prod", "local_paths": [env!("CARGO_MANIFEST_DIR")], "remote_dir": "/home/ana" })).await;
    assert!(out.is_error && out.text.contains("protegido"), "{}", out.text);
    assert_eq!(asked(&c), 0);
    let out = call(&c, "read_file", json!({ "server": "web-prod", "path": "/home/ana/notas.txt" })).await;
    assert!(!out.is_error, "{}", out.text);
    let out = call(&c, "list_dir", json!({ "server": "web-prod", "path": "/home/ana" })).await;
    assert!(!out.is_error, "{}", out.text);
    let out = call(&c, "write_file", json!({ "server": "web-prod", "path": "/home/deploy/ok.txt", "content": "x" })).await;
    assert!(!out.is_error, "{}", out.text);
}

#[tokio::test]
async fn protected_mention_always_asks_even_with_auto() {
    let c = protected_core();
    c.set_auto_at("s-full", AutoLevel::All, AutoDuration::Session, 1).unwrap();
    set_answer(&c, Answer::Give(Decision::Always));
    for (cmd, who) in [("ls -la /home/ana", "ana"), ("cat /root/.bashrc", "root"), ("chown 1001 /srv/x", "ana")] {
        let before = asked(&c);
        let out = call(&c, "run_command", json!({ "server": "web-prod", "command": cmd })).await;
        assert!(!out.is_error, "{}", out.text);
        assert_eq!(asked(&c), before + 1, "{cmd}: debe preguntar");
        let (danger, remember) = last_danger(&c);
        assert_eq!(danger[0], format!("Toca un usuario protegido: {who}"));
        assert!(!remember);
    }
    // «Permitir siempre» no se guardó: vuelve a preguntar.
    let before = asked(&c);
    call(&c, "run_command", json!({ "server": "web-prod", "command": "ls -la /home/ana" })).await;
    assert_eq!(asked(&c), before + 1);
    assert!(c.config.get().remembered_of("s-full").is_empty());
    // Sin mencionarlos, el modo automático sigue igual.
    let before = asked(&c);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "uptime" })).await;
    assert!(!out.is_error && asked(&c) == before, "{}", out.text);
}

#[tokio::test]
async fn global_protected_applies_to_every_server() {
    let c = protected_core();
    // db-server (solo lectura) solo tiene el global «root»; «ana» no está protegida allí.
    let out = call(&c, "run_command", json!({ "server": "db-server", "command": "sudo -u root id" })).await;
    assert!(out.is_error && out.text.contains("«root»"), "{}", out.text);
    let mut cfg = config();
    cfg.protected_global.insert("root".into());
    let c = core_with(Mock::new(), cfg);
    *c.backend.stdout.lock().unwrap() = PASSWD.into();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "su - root" })).await;
    assert!(out.is_error && out.text.contains("«root»"), "{}", out.text);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "ls /home/ana" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(last_danger(&c).0.is_empty());
}
