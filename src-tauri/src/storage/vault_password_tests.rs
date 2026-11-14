//! Tests de la bóveda con contraseña (en vez de PIN) y de pasar de un tipo a otro.

use super::*;

const PASSWORD: &str = "caballo correcto ñ";

fn header_kind(dir: &TempDir) -> Option<String> {
    let env: Envelope = serde_json::from_str(&fs::read_to_string(dir.vault_path()).unwrap()).unwrap();
    env.kind
}

#[test]
fn password_rules() {
    for ok in ["12345678", "abcdefgh", "frase con espacios", "ñandú-ñandú", "  ocho  !"] {
        assert!(check_new_password(ok).is_ok(), "«{ok}»");
        assert!(check_new_secret(ok, PinKind::Password).is_ok(), "«{ok}»");
    }
    let long = "x".repeat(257);
    for bad in ["", "1234567", "corta", "        ", "ñandúes", long.as_str()] {
        assert!(matches!(check_new_password(bad), Err(AppError::Invalid(_))), "«{bad}»");
    }
    // 8 caracteres aunque ocupen más bytes.
    assert!(check_new_password("ññññññññ").is_ok());
    // Un PIN de 6 números no vale como contraseña, y una contraseña no vale como PIN.
    assert!(check_new_secret("123456", PinKind::Password).is_err());
    assert!(check_new_secret(PASSWORD, PinKind::Pin6).is_err());
    // "text" (bóvedas antiguas) no se puede elegir.
    assert!(check_new_secret(PASSWORD, PinKind::Text).is_err());
    let dir = TempDir::new();
    assert!(matches!(
        dir.vault().create(PASSWORD, PinKind::Text, BTreeMap::new(), FAST),
        Err(AppError::Invalid(_))
    ));
    assert!(matches!(
        dir.vault().create("corta", PinKind::Password, BTreeMap::new(), FAST),
        Err(AppError::Invalid(_))
    ));
    assert!(!dir.vault_path().exists());
    assert!(dir.1.key().is_none(), "ni siquiera se crea la llave del equipo");
}

#[test]
fn password_vault_roundtrip() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PASSWORD, PinKind::Password, map(&[("srv-1", "p1")]), FAST).unwrap();
    assert_eq!(v.status().pin_kind, PinKind::Password);
    assert_eq!(header_kind(&dir).as_deref(), Some("password"));

    // El tipo se sabe sin desbloquear (va en la cabecera) y sigue al guardar secretos.
    v.set("srv-2", "p2").unwrap().unwrap();
    let v2 = dir.vault();
    assert_eq!(
        v2.status(),
        VaultStatus { pin_kind: PinKind::Password, ..status(true, true) }
    );
    match v2.unlock("caballo incorrecto") {
        Err(AppError::AuthFailed(m)) => assert!(m.contains("contraseña"), "{m}"),
        r => panic!("{r:?}"),
    }
    v2.unlock(PASSWORD).unwrap();
    assert_eq!(get(&v2, "srv-1").unwrap().as_deref(), Some("p1"));
    assert_eq!(get(&v2, "srv-2").unwrap().as_deref(), Some("p2"));
    v2.check_pin(PASSWORD).unwrap();
}

#[test]
fn password_kind_is_authenticated() {
    let dir = TempDir::new();
    dir.vault().create(PASSWORD, PinKind::Password, map(&[("a", "1")]), FAST).unwrap();
    tamper(&dir, |j| j["kind"] = "pin6".into());
    let v = dir.vault();
    assert_eq!(v.status().pin_kind, PinKind::Pin6, "se lee lo que diga la cabecera…");
    assert!(v.unlock(PASSWORD).is_err(), "…pero alterada no abre");
    assert!(v.status().locked);
}

#[test]
fn password_failures_have_the_same_delays() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PASSWORD, PinKind::Password, map(&[("a", "1")]), FAST).unwrap();
    v.lock();
    for _ in 0..5 {
        assert!(matches!(v.unlock("no es esta"), Err(AppError::AuthFailed(_))));
    }
    assert_eq!(v.status().retry_after_secs, 0, "5 fallos libres");
    assert!(matches!(v.unlock("tampoco es"), Err(AppError::AuthFailed(_))));
    assert!(v.status().retry_after_secs > 0);
    assert!(matches!(v.unlock(PASSWORD), Err(AppError::Invalid(_))), "hay que esperar");
    assert!(dir.0.join(ATTEMPTS_FILE).exists());
}

#[test]
fn switch_pin_to_password_and_back() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();

    // Contraseña nueva demasiado corta: no cambia nada.
    assert!(matches!(v.change_pin(PIN, "corta", PinKind::Password, FAST), Err(AppError::Invalid(_))));
    // Con el PIN actual mal: tampoco.
    assert!(matches!(
        v.change_pin("000000", PASSWORD, PinKind::Password, FAST),
        Err(AppError::AuthFailed(_))
    ));
    assert_eq!(header_kind(&dir).as_deref(), Some("pin6"));

    v.change_pin(PIN, PASSWORD, PinKind::Password, FAST).unwrap();
    assert_eq!(v.status().pin_kind, PinKind::Password);
    assert!(!v.status().locked, "sigue desbloqueada");
    assert_eq!(header_kind(&dir).as_deref(), Some("password"));

    let v2 = dir.vault();
    assert_eq!(v2.status().pin_kind, PinKind::Password);
    assert!(matches!(v2.unlock(PIN), Err(AppError::AuthFailed(_))));
    v2.unlock(PASSWORD).unwrap();
    assert_eq!(get(&v2, "a").unwrap().as_deref(), Some("1"));

    // Y de vuelta a PIN, pidiendo la contraseña actual.
    v2.change_pin(PASSWORD, "135790", PinKind::Pin6, FAST).unwrap();
    assert_eq!(v2.status().pin_kind, PinKind::Pin6);
    let v3 = dir.vault();
    assert_eq!(v3.status().pin_kind, PinKind::Pin6);
    assert!(v3.unlock(PASSWORD).is_err());
    v3.unlock("135790").unwrap();
    assert_eq!(get(&v3, "a").unwrap().as_deref(), Some("1"));
}

#[test]
fn legacy_text_vault_can_switch_to_password() {
    let dir = TempDir::new();
    write_legacy(&dir, "frase vieja", &[("s1", "p1")]);
    let v = dir.vault();
    assert_eq!(v.status().pin_kind, PinKind::Text);
    v.change_pin("frase vieja", PASSWORD, PinKind::Password, FAST).unwrap();
    let v2 = dir.vault();
    assert_eq!(v2.status().pin_kind, PinKind::Password);
    v2.unlock(PASSWORD).unwrap();
    assert_eq!(get(&v2, "s1").unwrap().as_deref(), Some("p1"));
}

#[test]
fn enable_and_disable_with_password() {
    let dir = TempDir::new();
    let v = dir.vault();
    let kr = FakeKeyring::default();
    kr.data.borrow_mut().insert("s1".into(), "p1".into());
    // El enlace con el llavero comprueba la contraseña antes de tocar nada.
    assert!(matches!(
        secrets::enable_vault(&v, &kr, &ids(&["s1"]), "corta", PinKind::Password, FAST),
        Err(AppError::Invalid(_))
    ));
    assert_eq!(kr.data.borrow().len(), 1);

    let r = secrets::enable_vault(&v, &kr, &ids(&["s1"]), PASSWORD, PinKind::Password, FAST).unwrap();
    assert_eq!(r.moved, 1);
    assert!(kr.data.borrow().is_empty());
    assert_eq!(v.status().pin_kind, PinKind::Password);

    assert!(secrets::disable_vault(&v, &kr, PIN).is_err());
    secrets::disable_vault(&v, &kr, PASSWORD).unwrap();
    assert_eq!(*kr.data.borrow(), map(&[("s1", "p1")]));
    assert_eq!(v.status(), status(false, false), "sin bóveda vuelve a PIN por defecto");
}
