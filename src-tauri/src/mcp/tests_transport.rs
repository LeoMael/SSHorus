//! Pruebas con el motor simulado de `tests.rs`: transporte HTTP (token, origen, bloqueo) y puente
//! stdio. Las utilidades (`spawn_http`, `post`, `spawn_bridge`…) siguen en `tests.rs`.

use super::*;

#[tokio::test]
async fn http_token_origin_and_lock() {
    let g = gate(false);
    let (port, _core, ct) = spawn_http(g.clone()).await;
    // Sin token o con uno incorrecto: 401.
    let (s, body) = post(port, INIT, None, false).await;
    assert_eq!(s, 401, "{body}");
    let (s, _) = post(port, INIT, Some("tv_otro"), false).await;
    assert_eq!(s, 401);
    let (s, _) = post(port, INIT, Some("tv_prueb"), false).await;
    assert_eq!(s, 401);
    // Páginas web (cabecera Origin): 403 aunque traigan el token.
    let (s, _) = post(port, INIT, Some(TOKEN), true).await;
    assert_eq!(s, 403);
    // Bien.
    let (s, body) = post(port, INIT, Some(TOKEN), false).await;
    assert_eq!(s, 200, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["result"]["serverInfo"]["name"], "sshorus");
    // Bloqueado: error JSON-RPC claro, con el mismo id.
    g.locked.store(true, Ordering::SeqCst);
    let (s, body) = post(port, r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#, Some(TOKEN), false).await;
    assert_eq!(s, 200);
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["id"], 7);
    assert_eq!(v["error"]["message"], LOCKED_MSG);
    ct.cancel();
}

#[test]
fn same_token_compares_everything() {
    assert!(http::same_token("abc", "abc"));
    assert!(!http::same_token("abc", "abd"));
    assert!(!http::same_token("abc", "abcd"));
    assert!(!http::same_token("", "a"));
    let t = crate::mcp::new_token().unwrap();
    assert!(t.starts_with("tv_") && t.len() == 67);
    assert_ne!(*t, *crate::mcp::new_token().unwrap());
}

#[tokio::test]
async fn bridge_forwards_to_app() {
    let (port, _core, ct) = spawn_http(gate(false)).await;
    let (mut w, mut r) = spawn_bridge(port, Some(TOKEN));
    send(&mut w, INIT).await;
    let v = recv(&mut r).await;
    assert_eq!(v["result"]["serverInfo"]["name"], "sshorus");
    send(&mut w, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).await;
    send(&mut w, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).await;
    let v = recv(&mut r).await;
    assert_eq!(v["id"], 2);
    let names: Vec<&str> = v["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    for n in ["list_servers", "run_command", "read_file", "write_file", "list_ports", "list_containers"] {
        assert!(names.contains(&n), "falta {n}: {names:?}");
    }
    send(&mut w, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_servers","arguments":{}}}"#).await;
    let v = recv(&mut r).await;
    assert_eq!(v["id"], 3);
    let text = v["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("web-prod"), "{text}");
    // El cliente queda en el registro (User-Agent del puente con el nombre del cliente).
    let log = _core.audit.list();
    assert!(log[0].client.as_deref().unwrap_or("").contains("prueba"), "{:?}", log[0].client);
    ct.cancel();
}

#[tokio::test]
async fn bridge_with_wrong_token() {
    let (port, _core, ct) = spawn_http(gate(false)).await;
    let (mut w, mut r) = spawn_bridge(port, Some("tv_mal"));
    send(&mut w, INIT).await;
    let v = recv(&mut r).await;
    assert!(v["error"]["message"].as_str().unwrap().contains("Token incorrecto"), "{v}");
    ct.cancel();
}

#[tokio::test]
async fn bridge_when_app_is_closed() {
    // Un puerto libre sin nadie escuchando.
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let (mut w, mut r) = spawn_bridge(port, Some(TOKEN));
    send(&mut w, INIT).await;
    let v = recv(&mut r).await;
    assert_eq!(v["result"]["protocolVersion"], "2025-06-18");
    assert!(v["result"]["instructions"].as_str().unwrap().contains(bridge::CLOSED_MSG));
    send(&mut w, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).await;
    let v = recv(&mut r).await;
    let tools = v["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1);
    assert!(tools[0]["description"].as_str().unwrap().contains(bridge::CLOSED_MSG));
    send(&mut w, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sshorus_abrir","arguments":{}}}"#).await;
    let v = recv(&mut r).await;
    assert_eq!(v["result"]["content"][0]["text"], bridge::CLOSED_MSG);
    send(&mut w, r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_servers","arguments":{}}}"#).await;
    let v = recv(&mut r).await;
    assert_eq!(v["error"]["message"], bridge::CLOSED_MSG);
    // Se abre la app: el puente avisa de que cambió la lista de herramientas.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    let ct = CancellationToken::new();
    tokio::spawn(http::serve(listener, Arc::new(core()), gate(false), ct.clone()));
    let v = recv(&mut r).await;
    assert_eq!(v["method"], "notifications/tools/list_changed");
    send(&mut w, r#"{"jsonrpc":"2.0","id":5,"method":"tools/list"}"#).await;
    let v = recv(&mut r).await;
    assert!(v["result"]["tools"].as_array().unwrap().len() > 10);
    ct.cancel();
}

#[test]
fn sse_parser() {
    let mut p = bridge::forward::SseParser::default();
    assert!(p.push(b"data: {\"a\":").is_empty());
    let out = p.push(b"1}\n\nevent: message\r\ndata: {\"b\":2}\r\n\r\ndata: {\"c\"");
    assert_eq!(out, vec![r#"{"a":1}"#.to_string(), r#"{"b":2}"#.to_string()]);
    assert_eq!(p.push(b":3}"), Vec::<String>::new());
    assert_eq!(p.finish(), vec![r#"{"c":3}"#.to_string()]);
    // Un carácter UTF-8 partido entre dos trozos no se estropea.
    let msg = "data: {\"t\":\"ñandú\"}\n\n".as_bytes();
    let cut = msg.iter().position(|&b| b == 0xC3).unwrap() + 1;
    let mut p = bridge::forward::SseParser::default();
    assert!(p.push(&msg[..cut]).is_empty());
    assert_eq!(p.push(&msg[cut..]), vec![r#"{"t":"ñandú"}"#.to_string()]);
}
