//! «Solo lo marcado» y usuarios protegidos contra el servidor de pruebas (`terview-sshd`): comando de la
//! Biblioteca permitido y denegado, carpetas permitidas con `..` y enlaces simbólicos reales, y el usuario
//! conectado protegido (su carpeta personal se lee de verdad con getent/passwd).
//! `cargo test --lib mcp::e2e -- --ignored --test-threads=1`

use super::*;
use crate::mcp::core::CatalogEntry;
use crate::mcp::grants::{Grants, Task};

fn entry(id: &str, command: &str, perm: &str) -> CatalogEntry {
    CatalogEntry {
        id: id.into(),
        category: "Prueba".into(),
        name: id.into(),
        description: None,
        command: command.into(),
        dangerous: false,
        sudo: false,
        read_only: false,
        interactive: false,
        perm: Some(perm.into()),
        scope: None,
    }
}

#[tokio::test]
#[ignore]
async fn marked_access_end_to_end() {
    let env = start().await;
    let core = env.core.clone();
    let sid = core.backend.sessions.list().await[0].id.clone();
    let s = core.backend.sessions.get(&sid).await.unwrap();
    let base = env.base.clone();
    exec::run(&s, &format!("mkdir -p {base}/www && ln -s /config {base}/www/fuga"), 10).await.unwrap();
    let id = test_profile().id;
    core.config
        .update(|c| {
            c.access.insert(id.clone(), Access::Custom);
            c.grants.insert(
                id.clone(),
                Grants { tasks: [Task::Web, Task::Files].into_iter().collect(), folders: vec![format!("{base}/www")], free_commands: false },
            );
        })
        .unwrap();
    core.set_catalog(vec![
        entry("web.saludo", "echo permitido {{nombre}}", "web"),
        entry("usuarios.borrar", "echo no-deberia {{usuario}}", "users-delete"),
    ]);
    let call = |tool: &'static str, args: Value| {
        let core = core.clone();
        async move { core.call(tool, args, None, CancellationToken::new()).await }
    };
    let server = "Servidor de pruebas";

    let ok = call("run_catalog_command", json!({ "server": server, "id": "web.saludo", "vars": { "nombre": "ana" } })).await;
    assert!(!ok.is_error && ok.text.contains("permitido ana"), "{}", ok.text);
    let no = call("run_catalog_command", json!({ "server": server, "id": "usuarios.borrar", "vars": { "usuario": "x" } })).await;
    assert!(no.is_error && no.text.contains("Usuarios: borrar"), "{}", no.text);
    let free = call("run_command", json!({ "server": server, "command": "id" })).await;
    assert!(free.is_error && free.text.contains("Comandos libres"), "{}", free.text);

    let write = |path: String| json!({ "server": server, "path": path, "content": "hola\n" });
    let inside = call("write_file", write(format!("{base}/www/index.html"))).await;
    assert!(!inside.is_error, "{}", inside.text);
    for bad in [format!("{base}/www/../fuera.txt"), format!("{base}/www/fuga/robado.txt")] {
        let out = call("write_file", write(bad.clone())).await;
        assert!(out.is_error && out.text.contains("fuera"), "{bad}: {}", out.text);
    }
    let r = exec::run(&s, "test -e /config/robado.txt && echo existe || echo no", 10).await.unwrap();
    assert_eq!(r.stdout.trim(), "no");

    // El usuario conectado («test», home /config) protegido: no se escribe en su carpeta.
    core.config
        .update(|c| {
            c.protected_users.insert(id.clone(), ["test".to_string()].into_iter().collect());
        })
        .unwrap();
    let out = call("write_file", write(format!("{base}/www/otra.html"))).await;
    assert!(out.is_error && out.text.contains("«test»"), "{}", out.text);
    let read = call("read_file", json!({ "server": server, "path": format!("{base}/www/index.html") })).await;
    assert!(!read.is_error && read.text.contains("hola"), "{}", read.text);
    env.cleanup().await;
}
