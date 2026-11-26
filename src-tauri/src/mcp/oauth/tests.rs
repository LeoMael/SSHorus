//! Pruebas de OAuth sin red: PKCE, direcciones de vuelta, metadatos, clientes, códigos de un solo uso,
//! rotación del token de renovación y revocación. El recorrido completo por HTTP (con el navegador y el
//! diálogo simulados) está en `mcp/tests_oauth.rs`.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use super::super::audit::AuditLog;
use super::super::pairing::applicant::Applicant;
use super::super::pairing::model::{ClientView, OAuthLink, PairPrompt, Via};
use super::super::pairing::notify::PairNotifier;
use super::super::pairing::registry::ClientRegistry;
use super::super::pairing::{Auth, Pairing};
use super::super::policy::Access;
use super::clients::{self, RegistrationRequest, Source};
use super::directory::{Directory, StaticDocs};
use super::form::Params;
use super::metadata::{self, Here};
use super::store::{AccessUse, CodeGrant, CodeUse, Store, ACCESS_SECS, CODE_MS};
use super::{pkce, redirect, OAuth};

#[test]
fn pkce_s256_matches_the_rfc_example() {
    // RFC 7636, apéndice B.
    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    let challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    assert_eq!(pkce::challenge_of(verifier), challenge);
    assert!(pkce::valid_challenge(challenge));
    assert!(pkce::verify_s256(verifier, challenge));
    assert!(!pkce::verify_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl", challenge));
    // Verificador demasiado corto o con caracteres no permitidos.
    assert!(!pkce::valid_verifier("corto"));
    assert!(!pkce::valid_verifier(&format!("{}+", "a".repeat(50))));
    assert!(!pkce::valid_challenge("plain-no-vale"));
}

#[test]
fn redirects_only_to_this_machine_and_to_registered_paths() {
    for ok in ["http://127.0.0.1:3118/callback", "http://localhost/callback", "http://[::1]:9/cb?x=1"] {
        assert!(redirect::loopback(ok).is_some(), "{ok}");
    }
    for bad in [
        "https://127.0.0.1/callback",
        "http://evil.example/callback",
        "http://127.0.0.1.evil.example/cb",
        "http://user@127.0.0.1/cb",
        "http://127.0.0.1/cb#frag",
        "nada",
    ] {
        assert!(redirect::loopback(bad).is_none(), "{bad}");
    }
    let registered = vec!["http://localhost/callback".to_string(), "http://127.0.0.1/callback".to_string()];
    // El puerto puede cambiar (RFC 8252 §7.3)…
    assert!(redirect::allowed("http://localhost:3118/callback", &registered));
    assert!(redirect::allowed("http://127.0.0.1:50000/callback", &registered));
    // …pero no la máquina, la ruta ni la consulta.
    assert!(!redirect::allowed("http://[::1]:3118/callback", &registered));
    assert!(!redirect::allowed("http://localhost:3118/otra", &registered));
    assert!(!redirect::allowed("http://localhost:3118/callback?x=1", &registered));
    assert!(!redirect::allowed("https://localhost:3118/callback", &registered));
    let back = redirect::with_params("http://127.0.0.1:1/cb", &[("code", "a b"), ("state", "x&y")]);
    assert_eq!(back, "http://127.0.0.1:1/cb?code=a+b&state=x%26y");
}

#[test]
fn metadata_documents_and_host_check() {
    let here = Here::from_host("127.0.0.1:4711", 4711).unwrap();
    assert_eq!(Here::from_host("LOCALHOST:4711", 4711).unwrap().issuer(), "http://localhost:4711");
    assert!(Here::from_host("127.0.0.1:4712", 4711).is_none(), "otro puerto");
    assert!(Here::from_host("evil.example:4711", 4711).is_none(), "DNS rebinding");
    assert!(Here::from_host("127.0.0.1", 4711).is_none());

    let prm = metadata::protected_resource(&here);
    assert_eq!(prm["resource"], "http://127.0.0.1:4711/mcp");
    assert_eq!(prm["authorization_servers"][0], "http://127.0.0.1:4711");
    let asm = metadata::authorization_server(&here);
    assert_eq!(asm["issuer"], "http://127.0.0.1:4711");
    assert_eq!(asm["authorization_endpoint"], "http://127.0.0.1:4711/authorize");
    assert_eq!(asm["token_endpoint"], "http://127.0.0.1:4711/token");
    assert_eq!(asm["registration_endpoint"], "http://127.0.0.1:4711/register");
    assert_eq!(asm["code_challenge_methods_supported"], serde_json::json!(["S256"]));
    assert_eq!(asm["token_endpoint_auth_methods_supported"], serde_json::json!(["none"]));
    assert_eq!(asm["client_id_metadata_document_supported"], true);
    assert_eq!(asm["authorization_response_iss_parameter_supported"], true);
    assert_eq!(
        metadata::challenge(&here, false),
        "Bearer resource_metadata=\"http://127.0.0.1:4711/.well-known/oauth-protected-resource/mcp\""
    );
    assert!(metadata::challenge(&here, true).ends_with("error=\"invalid_token\""));

    assert!(metadata::same_resource("http://127.0.0.1:4711/mcp", "http://localhost:4711/mcp/"));
    assert!(!metadata::same_resource("http://127.0.0.1:4711/mcp", "http://127.0.0.1:4712/mcp"));
    assert!(!metadata::same_resource("http://127.0.0.1:4711/mcp", "http://127.0.0.1:4711/otro"));
    assert!(!metadata::same_resource("http://127.0.0.1:4711/mcp", "https://127.0.0.1:4711/mcp"));
}

#[test]
fn params_reject_repeated_keys() {
    let p = Params::parse("a=1&b=dos+palabras&c=%2F").unwrap();
    assert_eq!((p.get("a"), p.get("b"), p.get("c"), p.get("z")), (Some("1"), Some("dos palabras"), Some("/"), None));
    assert!(Params::parse("a=1&a=2").is_none());
    assert_eq!(Params::parse("vacio=").unwrap().get("vacio"), None);
}

const CIMD: &str = "https://claude.ai/oauth/claude-code-client-metadata";

fn cimd_doc(client_id: &str, redirects: &[&str]) -> Vec<u8> {
    serde_json::json!({ "client_id": client_id, "client_name": "Claude Code", "redirect_uris": redirects }).to_string().into_bytes()
}

#[test]
fn client_metadata_documents_and_dynamic_registration() {
    assert!(clients::metadata_url(CIMD).is_some());
    for bad in ["http://claude.ai/x", "https://claude.ai/", "https://127.0.0.1/x", "https://localhost/x", "sshorus-1234"] {
        assert!(clients::metadata_url(bad).is_none(), "{bad}");
    }
    let doc = cimd_doc(CIMD, &["http://localhost/callback", "https://claude.ai/api/mcp/auth_callback"]);
    let c = clients::from_metadata(CIMD, &doc).unwrap();
    assert_eq!(c.name, "Claude Code");
    assert_eq!(c.redirect_uris, vec!["http://localhost/callback"], "solo las de este equipo");
    assert_eq!(c.source, Source::Metadata { host: "claude.ai".into() });
    // El documento tiene que decir que es de esa misma dirección.
    assert!(clients::from_metadata(CIMD, &cimd_doc("https://otro.example/x", &["http://localhost/cb"])).is_err());
    assert!(clients::from_metadata(CIMD, &cimd_doc(CIMD, &["https://claude.ai/cb"])).is_err());
    let secret = serde_json::json!({ "client_id": CIMD, "redirect_uris": ["http://localhost/cb"], "token_endpoint_auth_method": "client_secret_basic" });
    assert!(clients::from_metadata(CIMD, secret.to_string().as_bytes()).is_err());

    let req = |uris: &[&str], method: Option<&str>| RegistrationRequest {
        client_name: Some("Codex".into()),
        redirect_uris: uris.iter().map(|s| s.to_string()).collect(),
        token_endpoint_auth_method: method.map(str::to_string),
        ..Default::default()
    };
    let c = clients::register(req(&["http://127.0.0.1:1455/auth/callback"], None), "id1".into()).unwrap();
    assert_eq!((c.name.as_str(), c.source.clone()), ("Codex", Source::Registered));
    assert_eq!(clients::register(req(&["https://evil.example/cb"], None), "x".into()).unwrap_err().code, "invalid_redirect_uri");
    assert_eq!(clients::register(req(&[], None), "x".into()).unwrap_err().code, "invalid_redirect_uri");
    assert!(clients::register(req(&["http://localhost/cb"], Some("client_secret_post")), "x".into()).is_err());
    let v = clients::registration_response(&c, 7);
    assert_eq!((v["client_id"].as_str(), v["token_endpoint_auth_method"].as_str()), (Some("id1"), Some("none")));
}

fn grant(now: u64) -> CodeGrant {
    CodeGrant {
        client_id: "c1".into(),
        redirect_uri: "http://localhost/cb".into(),
        redirect_given: true,
        code_challenge: pkce::challenge_of(&"v".repeat(43)),
        resource: "http://127.0.0.1:1/mcp".into(),
        scope: None,
        applicant: Applicant::new("prueba-http", "Prueba", Via::OAuth).unwrap(),
        access: BTreeMap::new(),
        expires_at: now + CODE_MS,
    }
}

#[test]
fn codes_are_single_use_and_expire() {
    let mut s = Store::default();
    let code = s.put_code(grant(1_000), 1_000).unwrap();
    assert!(code.starts_with("tvx_"));
    assert!(matches!(s.take_code(&code, 1_500), CodeUse::Valid(_)));
    s.code_redeemed(&code, "prueba-http");
    // Segunda vez: se reconoce como repetido (y dice a quién se dio, para revocarlo).
    assert!(matches!(s.take_code(&code, 1_600), CodeUse::Reused(Some(id)) if id == "prueba-http"));
    // Caducado a los 60 s.
    let old = s.put_code(grant(2_000), 2_000).unwrap();
    assert!(matches!(s.take_code(&old, 2_000 + CODE_MS), CodeUse::Unknown));
    // Uno inventado con la forma correcta.
    assert!(matches!(s.take_code(&format!("tvx_0000aaaa_{}", "0".repeat(64)), 3_000), CodeUse::Unknown));
}

#[test]
fn access_tokens_expire_and_can_be_dropped() {
    let mut s = Store::default();
    let t = s.add_access("abcd1234", "http://127.0.0.1:1/mcp", 0).unwrap();
    assert_eq!(s.check_access(&t, 1), AccessUse::Valid { kid: "abcd1234".into(), resource: "http://127.0.0.1:1/mcp".into() });
    assert_eq!(s.check_access(&t, ACCESS_SECS * 1000), AccessUse::Expired);
    let t2 = s.add_access("abcd1234", "http://127.0.0.1:1/mcp", 10).unwrap();
    s.drop_access(&t2);
    assert_eq!(s.check_access(&t2, 11), AccessUse::Unknown);
    assert_eq!(s.check_access("tv_general", 11), AccessUse::Unknown);
}

struct Silent;

impl PairNotifier for Silent {
    fn show(&self, _: &PairPrompt) {}
    fn done(&self, _: &str) {}
    fn changed(&self, _: &[ClientView]) {}
}

fn oauth() -> (Arc<Pairing>, OAuth) {
    let pairing = Arc::new(Pairing::new(ClientRegistry::at(None), Box::new(Silent)));
    let directory = Directory::new(Box::new(StaticDocs(HashMap::new())), None);
    (pairing.clone(), OAuth::new(pairing, directory))
}

fn refresh_params(tok: &str, client_id: &str) -> Params {
    Params::parse(&format!("grant_type=refresh_token&refresh_token={tok}&client_id={client_id}")).unwrap()
}

#[test]
fn refresh_rotates_and_revoking_kills_every_token() {
    let (pairing, o) = oauth();
    let audit = AuditLog::at(None);
    let here = Here::from_host("127.0.0.1:1", 1).unwrap();
    let a = Applicant::new("prueba-http", "Prueba", Via::OAuth).unwrap();
    let link = OAuthLink { client_id: "c1".into(), resource: here.resource() };
    let access = BTreeMap::from([("s1".to_string(), Access::Read)]);
    let (refresh, client) = pairing.issue(&a, access, Some(link)).unwrap();
    assert!(refresh.starts_with("tvr_"));
    assert_eq!(client.via, Via::OAuth);
    // El token de renovación no sirve como token de acceso ni como el del puente.
    assert_eq!(o.authenticate(&refresh, &here, &audit), Auth::Unknown);
    assert_eq!(pairing.authenticate(&refresh, &audit), Auth::Unknown);

    // Otro cliente no puede usarlo.
    assert_eq!(o.token(&refresh_params(&refresh, "otro"), &audit).err().map(|e| e.code), Some("invalid_grant"));
    let t1 = o.token(&refresh_params(&refresh, "c1"), &audit).unwrap();
    // Rotación: el viejo ya no vale; el nuevo sí.
    assert_eq!(o.token(&refresh_params(&refresh, "c1"), &audit).err().map(|e| e.code), Some("invalid_grant"));
    let t2 = o.token(&refresh_params(&t1.refresh, "c1"), &audit).unwrap();
    assert!(matches!(o.authenticate(&t1.access, &here, &audit), Auth::Client(g) if g.id == "prueba-http"));
    // Ligado al recurso: en otro puerto no vale.
    let elsewhere = Here::from_host("127.0.0.1:2", 2).unwrap();
    assert_eq!(o.authenticate(&t2.access, &elsewhere, &audit), Auth::Unknown);

    // «Revocar» en SSHorus: acceso y renovación dejan de valer al instante.
    pairing.revoke("prueba-http", &audit).unwrap();
    assert!(matches!(o.authenticate(&t2.access, &here, &audit), Auth::Revoked(m) if m.contains("Vuelve a conectarlo")));
    let err = o.token(&refresh_params(&t2.refresh, "c1"), &audit).err().unwrap();
    assert_eq!(err.code, "invalid_grant");
    assert!(audit.list().iter().any(|e| e.tool == "emparejar: revocar"));
}

#[test]
fn revoke_endpoint_disconnects_with_the_refresh_token() {
    let (pairing, o) = oauth();
    let audit = AuditLog::at(None);
    let a = Applicant::new("x-http", "X", Via::OAuth).unwrap();
    let link = OAuthLink { client_id: "c1".into(), resource: "http://127.0.0.1:1/mcp".into() };
    let (refresh, _) = pairing.issue(&a, BTreeMap::new(), Some(link)).unwrap();
    // De otro cliente: no hace nada.
    o.revoke(&Params::parse(&format!("token={}&client_id=otro", refresh.as_str())).unwrap(), &audit);
    assert_eq!(pairing.clients().len(), 1);
    o.revoke(&Params::parse(&format!("token={}", refresh.as_str())).unwrap(), &audit);
    assert!(pairing.clients().is_empty());
    assert!(audit.list().iter().any(|e| e.tool == "emparejar: OAuth" && e.detail.contains("cerró")));
}

#[tokio::test]
async fn directory_resolves_metadata_documents_and_registrations() {
    let docs = HashMap::from([(CIMD.to_string(), cimd_doc(CIMD, &["http://localhost/callback"]))]);
    let dir = Directory::new(Box::new(StaticDocs(docs)), None);
    let c = dir.resolve(CIMD, 0).await.unwrap();
    assert_eq!(c.name, "Claude Code");
    assert!(dir.resolve("https://desconocido.example/x", 0).await.is_err());
    assert!(dir.resolve("sshorus-nada", 0).await.is_err());
    let reg = dir
        .register(RegistrationRequest { redirect_uris: vec!["http://127.0.0.1/cb".into()], ..Default::default() })
        .unwrap();
    assert!(reg.client_id.starts_with("sshorus-"));
    assert_eq!(dir.resolve(&reg.client_id, 0).await.unwrap(), reg);
}

#[test]
fn token_asks_for_redirect_uri_only_if_authorize_had_it() {
    let (_, o) = oauth();
    let audit = AuditLog::at(None);
    let verifier = "v".repeat(43);
    let exchange = |given: bool, redirect: Option<&str>| {
        let now = super::now_ms();
        let code = super::lock(&o.store).put_code(CodeGrant { redirect_given: given, ..grant(now) }, now).unwrap();
        let mut form = format!("grant_type=authorization_code&code={}&client_id=c1&code_verifier={verifier}", code.as_str());
        if let Some(r) = redirect {
            form.push_str(&format!("&redirect_uri={r}"));
        }
        o.token(&Params::parse(&form).unwrap(), &audit).map(|_| ()).map_err(|e| e.code)
    };
    // Sin redirect_uri en /authorize (era la única registrada): /token no la pide.
    assert_eq!(exchange(false, None), Ok(()));
    assert_eq!(exchange(true, Some("http://localhost/cb")), Ok(()));
    assert_eq!(exchange(true, None), Err("invalid_grant"));
    assert_eq!(exchange(false, Some("http://localhost/otra")), Err("invalid_grant"));
}
