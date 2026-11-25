//! Emparejar por OAuth de punta a punta: un cliente OAuth de mentira habla con el servidor HTTP real y el
//! «usuario» responde en el diálogo simulado. Descubrimiento (401 → metadatos), registro dinámico y documento
//! de metadatos, `/authorize` con su página de espera, canje con PKCE, uso con SUS permisos, renovación con
//! rotación, revocar, rechazar, bloqueo y los intentos que deben fallar.

use std::collections::HashMap;

use reqwest::header::{HeaderMap, LOCATION, WWW_AUTHENTICATE};
use reqwest::Url;

use super::pairing_flow::{names, start_with, Env, Reply};
use super::*;
use crate::mcp::oauth::pkce;
use crate::mcp::pairing::model::Via;

const VERIFIER: &str = "verificador-de-prueba-con-mas-de-cuarenta-y-tres-caracteres_123";
const CIMD: &str = "https://claude.ai/oauth/claude-code-client-metadata";

fn http_client() -> reqwest::Client {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap()
}

fn base(env: &Env) -> String {
    format!("http://127.0.0.1:{}", env.port)
}

/// `POST /mcp`: estado, cabeceras y cuerpo.
async fn mcp(env: &Env, token: Option<&str>, body: &str) -> (u16, HeaderMap, String) {
    let mut req = http_client()
        .post(format!("{}/mcp", base(env)))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(body.to_string());
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let r = req.send().await.unwrap();
    let (status, headers) = (r.status().as_u16(), r.headers().clone());
    (status, headers, r.text().await.unwrap())
}

async fn get_json(env: &Env, path: &str) -> Value {
    http_client().get(format!("{}{path}", base(env))).send().await.unwrap().json().await.unwrap()
}

async fn register(env: &Env, name: &str, redirect: &str) -> String {
    let r = http_client()
        .post(format!("{}/register", base(env)))
        .json(&json!({ "client_name": name, "redirect_uris": [redirect], "token_endpoint_auth_method": "none" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 201);
    let v: Value = r.json().await.unwrap();
    v["client_id"].as_str().unwrap().to_string()
}

/// `/authorize` → página de espera → (diálogo) → a dónde vuelve el navegador.
async fn authorize(env: &Env, client_id: &str, redirect: &str, state: &str) -> Url {
    let mut url = Url::parse(&format!("{}/authorize", base(env))).unwrap();
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("code_challenge", &pkce::challenge_of(VERIFIER))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("resource", &format!("{}/mcp", base(env)));
    let r = http_client().get(url).header("User-Agent", "Navegador de prueba").send().await.unwrap();
    assert_eq!(r.status().as_u16(), 200);
    let page = r.text().await.unwrap();
    assert!(page.contains("Vuelve a SSHorus para aceptar"), "{page}");
    let id = page.split("/authorize/wait?id=").nth(1).unwrap().split('"').next().unwrap().to_string();
    let r = http_client().get(format!("{}/authorize/wait?id={id}", base(env))).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 302);
    Url::parse(r.headers()[LOCATION].to_str().unwrap()).unwrap()
}

fn param(url: &Url, key: &str) -> Option<String> {
    url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned())
}

async fn token(env: &Env, form: &[(&str, &str)]) -> (u16, Value) {
    let body: String = Url::parse_with_params("http://x/", form).unwrap().query().unwrap_or("").to_string();
    let r = http_client()
        .post(format!("{}/token", base(env)))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .unwrap();
    (r.status().as_u16(), r.json().await.unwrap())
}

async fn exchange(env: &Env, code: &str, client_id: &str, redirect: &str, verifier: &str) -> (u16, Value) {
    token(
        env,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
            ("resource", &format!("{}/mcp", base(env))),
        ],
    )
    .await
}

const LIST: &str = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_servers","arguments":{}}}"#;

#[tokio::test]
async fn oauth_discover_register_accept_use_refresh_and_revoke() {
    let env = start_with(vec![("prueba-http", Reply::Accept(vec![("s-full", Access::Full)]))], HashMap::new()).await;
    // Sin token: 401 que dice dónde están los metadatos.
    let (status, headers, _) = mcp(&env, None, INIT).await;
    assert_eq!(status, 401);
    let challenge = headers[WWW_AUTHENTICATE].to_str().unwrap().to_string();
    let prm_url = format!("{}/.well-known/oauth-protected-resource/mcp", base(&env));
    assert_eq!(challenge, format!("Bearer resource_metadata=\"{prm_url}\""));
    let prm = get_json(&env, "/.well-known/oauth-protected-resource/mcp").await;
    assert_eq!(prm["resource"], format!("{}/mcp", base(&env)));
    assert_eq!(prm["authorization_servers"][0], base(&env));
    let asm = get_json(&env, "/.well-known/oauth-authorization-server").await;
    assert_eq!(asm["issuer"], base(&env));

    // Registro dinámico y autorización (el puerto de vuelta cambia: vale).
    let client_id = register(&env, "Prueba", "http://127.0.0.1/callback").await;
    let redirect = "http://127.0.0.1:41999/callback";
    let back = authorize(&env, &client_id, redirect, "estado-1").await;
    assert!(back.as_str().starts_with(redirect));
    assert_eq!(param(&back, "state").as_deref(), Some("estado-1"));
    assert_eq!(param(&back, "iss"), Some(base(&env)));
    let code = param(&back, "code").unwrap();
    // El diálogo fue el mismo del puente, con lo que se sabe del cliente.
    let shown = env.last.lock().unwrap().clone().unwrap();
    assert_eq!((shown.client_id.as_str(), shown.via), ("prueba-http", Via::OAuth));
    assert!(shown.facts.iter().any(|f| f.label == "Identidad" && f.value.contains("sin comprobar")));
    assert!(shown.facts.iter().any(|f| f.label == "Navegador" && f.value == "Navegador de prueba"));

    let (status, tokens) = exchange(&env, &code, &client_id, redirect, VERIFIER).await;
    assert_eq!(status, 200, "{tokens}");
    assert_eq!(tokens["token_type"], "Bearer");
    let access = tokens["access_token"].as_str().unwrap().to_string();
    let refresh = tokens["refresh_token"].as_str().unwrap().to_string();

    // Con el token de acceso: solo SUS permisos (el token general vería más servidores).
    let (status, _, body) = mcp(&env, Some(&access), INIT).await;
    assert_eq!(status, 200, "{body}");
    let (_, _, body) = mcp(&env, Some(&access), LIST).await;
    assert_eq!(names(&serde_json::from_str(&body).unwrap()), vec!["web-prod"]);
    let log = env.core.audit.list();
    assert!(log.iter().any(|e| e.tool == "list_servers" && e.client_id.as_deref() == Some("prueba-http")));
    assert!(log.iter().any(|e| e.tool == "emparejar" && e.status == AuditStatus::Ok && e.client_id.as_deref() == Some("prueba-http")));
    assert_eq!(env.gate.pairing.clients()[0].via, Via::OAuth);

    // Renovar: llega otro token de renovación y el viejo ya no vale.
    let renew = |rt: String| {
        let cid = client_id.clone();
        let env = &env;
        async move { token(env, &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", &cid)]).await }
    };
    let (status, again) = renew(refresh.clone()).await;
    assert_eq!(status, 200, "{again}");
    let refresh2 = again["refresh_token"].as_str().unwrap().to_string();
    assert_ne!(refresh2, refresh);
    let (status, err) = renew(refresh).await;
    assert_eq!((status, err["error"].as_str()), (400, Some("invalid_grant")));

    // «Revocar» en SSHorus: el token de acceso y el de renovación dejan de valer al instante.
    env.gate.pairing.revoke("prueba-http", &env.core.audit).unwrap();
    let (status, headers, body) = mcp(&env, Some(&access), INIT).await;
    assert_eq!(status, 401);
    assert!(body.contains("ya no está emparejado"), "{body}");
    assert!(headers[WWW_AUTHENTICATE].to_str().unwrap().contains("error=\"invalid_token\""));
    let (status, _) = renew(refresh2).await;
    assert_eq!(status, 400);
    env.ct.cancel();
}

#[tokio::test]
async fn oauth_reject_locked_and_invalid_requests() {
    let env =
        start_with(vec![("prueba-http", Reply::Reject), ("bloqueo-http", Reply::LockThenAccept)], HashMap::new()).await;
    let client_id = register(&env, "Prueba", "http://localhost/callback").await;
    let redirect = "http://localhost:5000/callback";
    // Rechazar: vuelve al cliente con access_denied y su state.
    let back = authorize(&env, &client_id, redirect, "s1").await;
    assert_eq!(param(&back, "error").as_deref(), Some("access_denied"));
    assert_eq!(param(&back, "state").as_deref(), Some("s1"));
    assert!(param(&back, "code").is_none());

    // Dirección de vuelta no registrada: página de error, sin volver al cliente.
    let url = format!("{}/authorize?response_type=code&client_id={client_id}&redirect_uri=http://localhost:5000/otra", base(&env));
    let r = http_client().get(url).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 400);
    assert!(r.headers().get(LOCATION).is_none());
    // Sin PKCE: vuelve con invalid_request.
    let url = format!("{}/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect}&state=s2", base(&env));
    let r = http_client().get(url).send().await.unwrap();
    let back = Url::parse(r.headers()[LOCATION].to_str().unwrap()).unwrap();
    assert_eq!((param(&back, "error").as_deref(), param(&back, "state").as_deref()), (Some("invalid_request"), Some("s2")));
    // Un código inventado no vale.
    let (status, err) = exchange(&env, &format!("tvx_0000aaaa_{}", "0".repeat(64)), &client_id, redirect, VERIFIER).await;
    assert_eq!((status, err["error"].as_str()), (400, Some("invalid_grant")));

    // Bloqueado: ni se autoriza ni se entregan tokens.
    env.gate.locked.store(true, Ordering::SeqCst);
    let r = http_client().get(format!("{}/authorize?client_id={client_id}", base(&env))).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 503);
    let (status, _) = token(&env, &[("grant_type", "refresh_token")]).await;
    assert_eq!(status, 503);
    env.gate.locked.store(false, Ordering::SeqCst);
    // Se bloquea mientras espera la respuesta: aunque se acepte, no hay código.
    let other = register(&env, "Bloqueo", "http://localhost/callback").await;
    let back = authorize(&env, &other, redirect, "s3").await;
    assert_eq!(param(&back, "error").as_deref(), Some("access_denied"));
    env.gate.locked.store(false, Ordering::SeqCst);

    // Desde una página web (Origin) o con otro nombre de máquina (DNS rebinding): fuera.
    let r = http_client().post(format!("{}/token", base(&env))).header("Origin", "https://malicioso.ejemplo").send().await.unwrap();
    assert_eq!(r.status().as_u16(), 403);
    let r = http_client()
        .get(format!("{}/.well-known/oauth-authorization-server", base(&env)))
        .header("Host", format!("malicioso.ejemplo:{}", env.port))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 421);
    assert!(env.gate.pairing.clients().is_empty());
    let denied = env.core.audit.list().into_iter().filter(|e| e.tool == "emparejar" && e.status != AuditStatus::Ok).count();
    assert_eq!(denied, 2);
    env.ct.cancel();
}

#[tokio::test]
async fn oauth_client_metadata_document_and_stolen_code() {
    let doc = json!({ "client_id": CIMD, "client_name": "Claude Code", "redirect_uris": ["http://localhost/callback", "http://127.0.0.1/callback"] });
    let docs = HashMap::from([(CIMD.to_string(), doc.to_string().into_bytes())]);
    let env = start_with(vec![("claude-code-http", Reply::Accept(vec![("s-read", Access::Read)]))], docs).await;
    let redirect = "http://localhost:3118/callback";
    let back = authorize(&env, CIMD, redirect, "a").await;
    let shown = env.last.lock().unwrap().clone().unwrap();
    assert_eq!(shown.name, "Claude Code");
    assert!(shown.facts.iter().any(|f| f.label == "Identidad" && f.value.contains("claude.ai")));
    // Sin el verificador PKCE, el código no sirve (y ya no se puede volver a intentar con él).
    let code = param(&back, "code").unwrap();
    let (status, err) = exchange(&env, &code, CIMD, redirect, "otro-verificador-que-no-es-el-bueno-0000000000000").await;
    assert_eq!((status, err["error"].as_str()), (400, Some("invalid_grant")));
    let (status, _) = exchange(&env, &code, CIMD, redirect, VERIFIER).await;
    assert_eq!(status, 400);

    // Otro intento: bien. Si alguien repite ese código, se revoca lo que dio.
    let back = authorize(&env, CIMD, redirect, "b").await;
    let code = param(&back, "code").unwrap();
    let (status, tokens) = exchange(&env, &code, CIMD, redirect, VERIFIER).await;
    assert_eq!(status, 200);
    let access = tokens["access_token"].as_str().unwrap().to_string();
    let (_, _, body) = mcp(&env, Some(&access), LIST).await;
    assert_eq!(names(&serde_json::from_str(&body).unwrap()), vec!["db-server"]);
    let (status, _) = exchange(&env, &code, CIMD, redirect, VERIFIER).await;
    assert_eq!(status, 400);
    let (status, _, _) = mcp(&env, Some(&access), LIST).await;
    assert_eq!(status, 401, "el código repetido revoca su acceso");
    assert!(env.core.audit.list().iter().any(|e| e.tool == "emparejar: OAuth" && e.detail.contains("Repitió")));
    env.ct.cancel();
}

#[tokio::test]
async fn auto_accept_follows_the_callers_own_access() {
    let env = start_with(vec![("prueba-http", Reply::Accept(vec![("s-none", Access::Full)]))], HashMap::new()).await;
    let core = core().with_paired(env.gate.pairing.clone());
    // Nadie tiene Completo en s-none: no se puede activar.
    assert!(core.set_auto_at("s-none", policy::AutoLevel::Changes, crate::mcp::core::AutoDuration::Session, 1).is_err());
    let client_id = register(&env, "Prueba", "http://127.0.0.1/callback").await;
    let back = authorize(&env, &client_id, "http://127.0.0.1:5/callback", "x").await;
    let (status, _) = exchange(&env, &param(&back, "code").unwrap(), &client_id, "http://127.0.0.1:5/callback", VERIFIER).await;
    assert_eq!(status, 200);
    // Un asistente con Completo ahí: ya se puede, y vale para él pero no para el token general (Sin acceso).
    core.set_auto_at("s-none", policy::AutoLevel::Changes, crate::mcp::core::AutoDuration::Session, 1).unwrap();
    assert_eq!(core.auto_level_for("s-none", Access::Full, 2), policy::AutoLevel::Changes);
    assert_eq!(core.auto_level_at("s-none", 2), policy::AutoLevel::Off);
    assert_eq!(core.auto_list_at(2).len(), 1);
    // Si se revoca, ya nadie puede usarlo y se apaga.
    env.gate.pairing.revoke("prueba-http", &env.core.audit).unwrap();
    assert!(core.prune_auto_at(3).unwrap());
    assert!(core.auto_list_at(3).is_empty());
    env.ct.cancel();
}
