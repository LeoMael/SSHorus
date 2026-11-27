//! Pruebas de las herramientas de despliegue: lecturas sin permiso, permisos por nivel y casilla, usuarios
//! rechazados, rutas subidas y resultado de los scripts.

use super::*;
use crate::mcp::grants::{Grants, Task};

fn custom(c: &McpCore<Mock>, tasks: &[Task]) {
    c.config
        .update(|cfg| {
            cfg.access.insert("s-full".into(), Access::Custom);
            cfg.grants.insert(
                "s-full".into(),
                Grants {
                    tasks: tasks.iter().copied().collect(),
                    folders: vec![],
                    free_commands: false,
                },
            );
        })
        .unwrap();
}

fn stdout(c: &McpCore<Mock>, s: &str) {
    *c.backend.stdout.lock().unwrap() = s.into();
}

#[tokio::test]
async fn guide_dns_and_status_are_reads_even_on_read_only_servers() {
    let c = core();
    let out = call(&c, "get_deploy_guide", json!({})).await;
    assert!(
        !out.is_error
            && out.text.contains("create_app_user")
            && out.text.contains("web.caddy-crear-sitio")
    );

    stdout(&c, "@@iface\n203.0.113.7\n@@domain\n203.0.113.7\n@@host\n");
    let out = call(
        &c,
        "check_dns",
        json!({ "server": "db-server", "domain": "App.Ejemplo.com" }),
    )
    .await;
    assert!(
        !out.is_error && out.text.contains("apunta a este servidor"),
        "{}",
        out.text
    );
    let out = call(
        &c,
        "check_dns",
        json!({ "server": "db-server", "domain": "http://x" }),
    )
    .await;
    assert!(out.is_error && out.text.contains("dominio"));

    stdout(&c, "@@listen=127.0.0.1:8080\n@@http_local=200\n");
    let out = call(
        &c,
        "deploy_status",
        json!({ "server": "db-server", "port": 8080 }),
    )
    .await;
    assert!(
        !out.is_error && out.text.starts_with("Todo bien."),
        "{}",
        out.text
    );
    let out = call(&c, "deploy_status", json!({ "server": "db-server" })).await;
    assert!(out.is_error && out.text.contains("Di qué comprobar"));
    assert_eq!(asked(&c), 0, "las lecturas no preguntan");
    assert!(
        ran(&c).iter().all(|cmd| !cmd.contains("sudo")),
        "las lecturas no usan sudo"
    );
}

#[tokio::test]
async fn create_app_user_asks_always_and_respects_levels() {
    let c = core();
    let out = call(
        &c,
        "create_app_user",
        json!({ "server": "db-server", "user": "blog" }),
    )
    .await;
    assert!(
        out.is_error && out.text.contains("solo lectura"),
        "{}",
        out.text
    );

    stdout(&c, "@@user=blog uid=1003 home=/home/blog\n");
    set_answer(&c, Answer::Give(Decision::Always));
    for _ in 0..2 {
        let out = call(
            &c,
            "create_app_user",
            json!({ "server": "web-prod", "user": "blog" }),
        )
        .await;
        assert!(
            !out.is_error && out.text.contains("uid 1003"),
            "{}",
            out.text
        );
    }
    assert_eq!(asked(&c), 2, "con sudo se pregunta siempre");
    let req = c.backend.asked.lock().unwrap()[0].clone();
    assert!(!req.can_remember && req.danger.iter().any(|d| d.contains("sudo")));
    assert!(
        req.command.contains("Sin contraseña y sin sudo"),
        "{}",
        req.command
    );
    assert!(ran(&c)[0].starts_with("sudo sh -c "));

    // Sin la marca de fin: error con la salida.
    stdout(&c, "useradd: falló\n");
    let out = call(
        &c,
        "create_app_user",
        json!({ "server": "web-prod", "user": "blog2" }),
    )
    .await;
    assert!(out.is_error && out.text.contains("No se pudo crear"));

    // Ni root, ni el usuario conectado, ni un protegido, ni un nombre raro.
    c.config
        .update(|cfg| {
            cfg.protected_global.insert("admin".into());
        })
        .unwrap();
    for (user, msg) in [
        ("root", "root"),
        ("deploy", "conectado"),
        ("admin", "protegido"),
        ("a;b", "válido"),
    ] {
        let out = call(
            &c,
            "create_app_user",
            json!({ "server": "web-prod", "user": user }),
        )
        .await;
        assert!(
            out.is_error && out.text.contains(msg),
            "{user}: {}",
            out.text
        );
    }

    // Solo lo marcado: hace falta «Usuarios: crear».
    custom(&c, &[Task::Web]);
    let out = call(
        &c,
        "create_app_user",
        json!({ "server": "web-prod", "user": "blog" }),
    )
    .await;
    assert!(
        out.is_error && out.text.contains("Usuarios: crear"),
        "{}",
        out.text
    );
    custom(&c, &[Task::UsersCreate]);
    stdout(&c, "@@user=blog uid=1003 home=/home/blog\n");
    let out = call(
        &c,
        "create_app_user",
        json!({ "server": "web-prod", "user": "blog" }),
    )
    .await;
    assert!(!out.is_error, "{}", out.text);
}

#[tokio::test]
async fn deploy_app_validates_paths_and_reports_the_state() {
    let c = core();
    let base = json!({ "server": "web-prod", "user": "blog", "name": "blog", "image": "docker.io/library/nginx:1.27", "port": 8080 });
    let with = |extra: Value| {
        let mut v = base.clone();
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        v
    };

    let out = call(&c, "deploy_app", with(json!({ "exec_start": "./app" }))).await;
    assert!(
        out.is_error && out.text.contains("no los dos"),
        "{}",
        out.text
    );
    let out = call(&c, "deploy_app", with(json!({ "volumes": ["../etc:/x"] }))).await;
    assert!(out.is_error && out.text.contains("volumen"), "{}", out.text);
    let out = call(&c, "deploy_app", with(json!({ "copy_from": "/etc" }))).await;
    assert!(
        out.is_error && out.text.contains("carpeta de «deploy»"),
        "{}",
        out.text
    );
    assert_eq!(asked(&c), 0, "lo que no vale se rechaza antes de preguntar");

    stdout(&c, "Trying to pull…\n@@state=active\n");
    let out = call(
        &c,
        "deploy_app",
        with(json!({ "copy_from": "/home/deploy/sshorus-deploy/blog", "env": { "TOKEN": "x" } })),
    )
    .await;
    assert!(
        !out.is_error && out.text.contains("en marcha en el puerto 8080"),
        "{}",
        out.text
    );
    let req = c.backend.asked.lock().unwrap()[0].clone();
    assert!(
        req.command.contains("127.0.0.1:8080") && req.command.contains("ExecStart=podman run"),
        "{}",
        req.command
    );
    assert!(!req.can_remember);
    let cmd = ran(&c).last().unwrap().clone();
    assert!(
        cmd.starts_with("sudo sh -c ") && cmd.contains("/home/deploy/sshorus-deploy/blog"),
        "{cmd}"
    );

    stdout(
        &c,
        "@@state=failed\n--- Últimos logs ---\nerror: puerto en uso\n",
    );
    let out = call(&c, "deploy_app", base.clone()).await;
    assert!(
        out.is_error
            && out.text.contains("no quedó en marcha")
            && out.text.contains("puerto en uso")
    );

    stdout(&c, "@@state=removed\n");
    let out = call(
        &c,
        "deploy_app",
        json!({ "server": "web-prod", "user": "blog", "name": "blog", "remove": true }),
    )
    .await;
    assert!(!out.is_error && out.text.contains("parada"), "{}", out.text);
    let last = c.backend.asked.lock().unwrap().last().unwrap().clone();
    assert!(last.danger.iter().any(|d| d.contains("detiene")));
}

#[tokio::test]
async fn deploy_app_needs_its_task_with_marked_access() {
    let c = core();
    let app = json!({ "server": "web-prod", "user": "blog", "name": "blog", "image": "docker.io/library/nginx:1.27" });
    let prog =
        json!({ "server": "web-prod", "user": "blog", "name": "blog", "exec_start": "./bin/blog" });
    custom(&c, &[Task::Services]);
    let out = call(&c, "deploy_app", app.clone()).await;
    assert!(
        out.is_error && out.text.contains("Contenedores"),
        "{}",
        out.text
    );
    stdout(&c, "@@state=active\n");
    let out = call(&c, "deploy_app", prog).await;
    assert!(!out.is_error, "{}", out.text);
    custom(&c, &[Task::Containers]);
    let out = call(&c, "deploy_app", app).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(ran(&c).iter().all(|cmd| cmd.contains("blog")));
}
