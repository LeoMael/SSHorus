//! Pruebas del emparejado sin red: límite de peticiones, tokens, lista de asistentes, revocar y permisos.
//! El recorrido completo por HTTP (pedir → aceptar → usar el token) está en `mcp/tests_pairing.rs`.

use std::collections::BTreeMap;

use super::super::caller::{Caller, ClientGrant};
use super::super::config::McpConfig;
use super::super::policy::Access;
use super::limiter::{Limited, RateLimiter, MAX_PER_WINDOW, WINDOW_MS};
use super::model::{clean_access, PairedClient, Via};
use super::registry::{pick_kid, ClientRegistry, TokenCheck};
use super::token::{self, Kind};

#[test]
fn limiter_one_waiting_per_client_and_three_per_minute() {
    let mut l = RateLimiter::default();
    assert_eq!(l.begin("claude", 0), Ok(()));
    // El mismo asistente no puede tener dos esperando.
    assert_eq!(l.begin("claude", 10), Err(Limited::AlreadyWaiting));
    l.finish("claude");
    assert_eq!(l.begin("claude", 20), Ok(()));
    l.finish("claude");
    assert_eq!(l.begin("codex", 30), Ok(()));
    l.finish("codex");
    assert_eq!(MAX_PER_WINDOW, 3);
    // Cuarta en el mismo minuto: rechazada aunque sea otro asistente.
    assert_eq!(l.begin("gemini", 40), Err(Limited::TooMany));
    // Pasado el minuto de la primera, vuelve a haber hueco.
    assert_eq!(l.begin("gemini", WINDOW_MS), Ok(()));
    assert_eq!(l.begin("otro", WINDOW_MS + 1), Err(Limited::TooMany));
}

#[test]
fn tokens_verify_only_themselves() {
    let kid = token::new_kid().unwrap();
    let a = token::issue(Kind::Bridge, &kid).unwrap();
    assert!(a.token.starts_with("tvc_"));
    assert_eq!(token::kid_of(&a.token, Kind::Bridge), Some(kid.as_str()));
    assert!(token::verify(&a.token, &a.hash));
    // Otro token con el mismo kid no vale.
    let b = token::issue(Kind::Bridge, &kid).unwrap();
    assert!(!token::verify(&b.token, &a.hash));
    // La huella no contiene el token.
    assert!(!a.hash.hash.contains(&a.token[13..]));
    // Formas que no son de asistente.
    assert_eq!(token::kid_of("tv_abc", Kind::Bridge), None);
    assert_eq!(token::kid_of("tvc_123_corto", Kind::Bridge), None);
    // El tipo va en el prefijo y la huella lo cubre: el mismo secreto con otro prefijo no vale.
    let refresh = token::issue(Kind::Refresh, &kid).unwrap();
    assert_eq!(token::parse(&refresh.token), Some((Kind::Refresh, kid.as_str())));
    assert_eq!(token::kid_of(&refresh.token, Kind::Bridge), None);
    let swapped = refresh.token.replacen("tvr_", "tvc_", 1);
    assert!(!token::verify(&swapped, &refresh.hash));
    assert!(token::constant_time_eq(b"abc", b"abc"));
    assert!(!token::constant_time_eq(b"abc", b"abcd"));
}

fn client(id: &str, token_hash: token::TokenHash, kid: &str, access: &[(&str, Access)]) -> PairedClient {
    PairedClient {
        id: id.into(),
        name: format!("Asistente {id}"),
        program: "claude".into(),
        pid: Some(42),
        cwd: Some("/home/u/proyecto".into()),
        created_at: 1,
        last_used: None,
        access: access.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        kid: kid.into(),
        token: token_hash,
        via: Via::Bridge,
        oauth: None,
    }
}

fn paired(reg: &ClientRegistry, id: &str, access: &[(&str, Access)]) -> String {
    let (_, tok) = reg
        .insert_new(10, |kid| {
            let t = token::issue(Kind::Bridge, kid)?;
            Ok((client(id, t.hash, kid, access), t.token))
        })
        .unwrap();
    tok.to_string()
}

#[test]
fn registry_check_revoke_and_replace() {
    let dir = std::env::temp_dir().join(format!("sshorus-pair-{}", uuid::Uuid::new_v4().simple()));
    let path = dir.join(super::registry::FILE_NAME);
    let reg = ClientRegistry::at(Some(path.clone()));
    let tok = paired(&reg, "claude", &[("s1", Access::Read)]);
    match reg.check(&tok, Kind::Bridge, 100) {
        TokenCheck::Valid(c) => assert_eq!(c.id, "claude"),
        other => panic!("{other:?}"),
    }
    assert_eq!(reg.get("claude").unwrap().last_used, Some(100));
    // En disco no está el token, solo su huella; y se vuelve a leer igual.
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains(&tok), "el token no debe guardarse");
    assert_eq!(ClientRegistry::at(Some(path.clone())).list(), reg.list());

    // Volver a emparejar: el token viejo queda revocado.
    let tok2 = paired(&reg, "claude", &[("s1", Access::Full)]);
    assert!(matches!(reg.check(&tok, Kind::Bridge, 200), TokenCheck::Revoked(r) if r.id == "claude"));
    assert!(matches!(reg.check(&tok2, Kind::Bridge, 200), TokenCheck::Valid(_)));
    assert_eq!(reg.list().len(), 1);

    // Revocar: deja de valer y se reconoce como revocado.
    reg.revoke("claude", 300).unwrap();
    assert!(matches!(reg.check(&tok2, Kind::Bridge, 300), TokenCheck::Revoked(_)));
    assert!(reg.revoke("claude", 300).is_err());
    assert!(reg.list().is_empty());
    // Un token inventado no es de nadie.
    assert_eq!(reg.check(&format!("tvc_0000aaaa_{}", "0".repeat(64)), Kind::Bridge, 1), TokenCheck::Unknown);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn revoked_token_failures_are_logged_once_a_minute() {
    let reg = ClientRegistry::at(None);
    assert!(reg.should_log_failure("k1", 0));
    assert!(!reg.should_log_failure("k1", 59_000));
    assert!(reg.should_log_failure("k2", 59_000));
    assert!(reg.should_log_failure("k1", 60_000));
}

#[test]
fn kids_never_repeat() {
    // Si sale un kid ya usado (por un asistente o un revocado), se pide otro.
    let mut seq = vec!["aaaa0001", "aaaa0002", "bbbb0003"].into_iter();
    let used = |k: &str| k.starts_with("aaaa");
    assert_eq!(pick_kid(used, || Ok(seq.next().unwrap_or("x").to_string())).unwrap(), "bbbb0003");
    assert!(pick_kid(|_| true, || Ok("aaaa0001".into())).is_err(), "se rinde en vez de repetir");
    // En la lista real, dos asistentes nunca comparten kid.
    let reg = ClientRegistry::at(None);
    paired(&reg, "a", &[]);
    paired(&reg, "b", &[]);
    let list = reg.list();
    assert_ne!(list[0].kid, list[1].kid);
}

#[test]
fn set_access_keeps_only_real_levels() {
    let reg = ClientRegistry::at(None);
    paired(&reg, "codex", &[]);
    let c = reg
        .set_access("codex", BTreeMap::from([("a".into(), Access::Full), ("b".into(), Access::None), (" ".into(), Access::Read)]))
        .unwrap();
    assert_eq!(c.access, BTreeMap::from([("a".to_string(), Access::Full)]));
    assert!(reg.set_access("nadie", BTreeMap::new()).is_err());
    assert!(clean_access(BTreeMap::from([("x".into(), Access::None)])).is_empty());
}

#[test]
fn paired_client_permissions_replace_the_global_ones() {
    let mut cfg = McpConfig::default();
    cfg.access.insert("s1".into(), Access::Full);
    cfg.access.insert("s2".into(), Access::Read);
    // Token general: los permisos de Ajustes.
    let global = Caller::default();
    assert_eq!(global.access_of(&cfg, "s1"), Access::Full);
    assert_eq!(global.access_of(&cfg, "s3"), Access::None);
    // Asistente emparejado: solo los suyos (pueden ser más o menos que los generales).
    let paired = Caller::paired(ClientGrant {
        id: "codex".into(),
        name: "Codex".into(),
        access: BTreeMap::from([("s2".into(), Access::Full), ("s3".into(), Access::Read)]),
    });
    assert_eq!(paired.access_of(&cfg, "s1"), Access::None);
    assert_eq!(paired.access_of(&cfg, "s2"), Access::Full);
    assert_eq!(paired.access_of(&cfg, "s3"), Access::Read);
}
