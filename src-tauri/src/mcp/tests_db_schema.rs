//! Pruebas de `get_db_schema`: se anuncia como lectura, pasa sin preguntar (también en solo lectura), se
//! rechaza sin acceso, valida los parámetros y a la interfaz solo le llegan los datos del destino.

use super::*;

/// Lo que devuelve la interfaz simulada (`Mock::ui_request("db-schema")`).
pub fn fixture() -> Value {
    json!({
        "target": "pg@127.0.0.1:5432",
        "database": "tienda",
        "tables": [{ "schema": "public", "name": "clientes", "columns": [{ "name": "id", "type": "integer", "pk": true }] }]
    })
}

fn db_payloads(c: &McpCore<Mock>) -> Vec<Value> {
    c.backend.ui_payloads.lock().unwrap().iter().filter(|(k, _)| k == "db-schema").map(|(_, v)| v.clone()).collect()
}

#[test]
fn db_schema_is_announced_as_read() {
    let tools = crate::mcp::server::tools();
    let t = tools.iter().find(|t| t.name == "get_db_schema").expect("falta get_db_schema");
    assert_eq!(t.annotations.as_ref().and_then(|a| a.read_only_hint), Some(true));
    let props = t.input_schema.get("properties").and_then(Value::as_object).expect("propiedades");
    for k in ["server", "session_id", "target", "sqlite_path", "database", "schema", "table"] {
        assert!(props.contains_key(k), "falta {k}: {props:?}");
    }
    assert!(!props.keys().any(|k| k.contains("password")), "no se piden contraseñas: {props:?}");
}

#[tokio::test]
async fn db_schema_reads_without_asking_even_on_read_only() {
    let c = core();
    let out = call(
        &c,
        "get_db_schema",
        json!({ "server": "db-server", "target": "pg@127.0.0.1:5432", "database": " tienda ", "table": "clientes" }),
    )
    .await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("\"clientes\""), "{}", out.text);
    assert_eq!(asked(&c), 0);
    assert!(ran(&c).is_empty(), "no ejecuta nada por su cuenta: lo hace la interfaz");
    let p = db_payloads(&c);
    assert_eq!(
        p,
        vec![json!({
            "sessionId": "ss-read",
            "profileId": "s-read",
            "target": "pg@127.0.0.1:5432",
            "database": "tienda",
            "schema": null,
            "table": "clientes",
        })]
    );
    let log = c.audit.list();
    assert_eq!(log[0].detail, "pg@127.0.0.1:5432 → tienda.clientes");
}

#[tokio::test]
async fn db_schema_without_target_lists_and_sqlite_path_becomes_target() {
    let c = core();
    assert!(!call(&c, "get_db_schema", json!({ "server": "web-prod" })).await.is_error);
    let out = call(&c, "get_db_schema", json!({ "server": "web-prod", "sqlite_path": "/srv/app/data.db" })).await;
    assert!(!out.is_error, "{}", out.text);
    let p = db_payloads(&c);
    assert_eq!(p[0]["target"], Value::Null);
    assert_eq!(p[1]["target"], "sqlite@/srv/app/data.db");
}

#[tokio::test]
async fn db_schema_rejects_no_access_and_bad_params() {
    let c = core();
    let out = call(&c, "get_db_schema", json!({ "server": "vps-personal" })).await;
    assert!(out.is_error, "{}", out.text);
    for args in [
        json!({ "server": "web-prod", "target": "pg@x", "sqlite_path": "/a.db" }),
        json!({ "server": "web-prod", "sqlite_path": "datos.db" }),
        json!({ "server": "web-prod", "target": "pg@x", "database": "a\nb" }),
        json!({ "server": "web-prod", "table": "x".repeat(400), "target": "pg@x" }),
    ] {
        let out = call(&c, "get_db_schema", args.clone()).await;
        assert!(out.is_error && out.text.contains("Parámetros no válidos"), "{args}: {}", out.text);
    }
    assert!(db_payloads(&c).is_empty());
    assert_eq!(asked(&c), 0);
}
