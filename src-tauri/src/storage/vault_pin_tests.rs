//! Tests de la bóveda: ida y vuelta, PIN, bloqueo y bóvedas antiguas. Las utilidades están en
//! `vault_tests.rs`.

use super::*;

// ───────── Ida y vuelta, PIN, bloqueo ─────────

#[test]
fn roundtrip_and_reopen() {
    let dir = TempDir::new();
    let v = dir.vault();
    assert_eq!(v.status(), status(false, false));
    assert!(v.get("a").is_none(), "sin bóveda se usa el llavero");

    v.create(PIN, PinKind::Pin6, map(&[("srv-1", "clave ñ 1"), ("github-token", "ghp_x")]), FAST).unwrap();
    assert!(v.status().enabled && !v.status().locked);
    assert_eq!(get(&v, "srv-1").unwrap().as_deref(), Some("clave ñ 1"));
    assert_eq!(get(&v, "nada").unwrap(), None);

    // Guardar y borrar escriben el archivo al momento.
    v.set("srv-2", "otra").unwrap().unwrap();
    v.delete("github-token").unwrap().unwrap();

    // En claro no aparece nada del contenido.
    let raw = fs::read_to_string(dir.vault_path()).unwrap();
    for s in ["clave", "srv-1", "srv-2", "otra"] {
        assert!(!raw.contains(s), "«{s}» no debe verse en el archivo");
    }

    // Otra instancia (como al reiniciar la app): empieza bloqueada.
    let v2 = dir.vault();
    assert_eq!(v2.status(), status(true, true));
    v2.unlock(PIN).unwrap();
    assert_eq!(v2.ids().unwrap(), vec!["srv-1".to_string(), "srv-2".to_string()]);
    assert_eq!(get(&v2, "srv-2").unwrap().as_deref(), Some("otra"));
    assert_eq!(get(&v2, "github-token").unwrap(), None);
}

#[test]
fn wrong_pin_fails() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let v = dir.vault();
    let err = v.unlock("654321").unwrap_err();
    assert!(matches!(err, AppError::AuthFailed(_)), "{err:?}");
    assert!(v.status().locked);
    assert!(matches!(get(&v, "a"), Err(AppError::Locked)));
    v.unlock(PIN).unwrap();
    assert_eq!(get(&v, "a").unwrap().as_deref(), Some("1"));
}

#[test]
fn locked_vault_refuses_everything() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    assert!(v.lock());
    assert!(!v.lock(), "bloquear dos veces no cambia nada");
    assert!(matches!(get(&v, "a"), Err(AppError::Locked)));
    assert!(matches!(v.set("a", "2"), Some(Err(AppError::Locked))));
    assert!(matches!(v.delete("a"), Some(Err(AppError::Locked))));
    assert!(matches!(v.ids(), Err(AppError::Locked)));
    // El archivo no cambió: sigue dando el valor de antes.
    v.unlock(PIN).unwrap();
    assert_eq!(get(&v, "a").unwrap().as_deref(), Some("1"));
}

#[test]
fn change_pin_reencrypts() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let before = fs::read_to_string(dir.vault_path()).unwrap();

    assert!(matches!(v.change_pin("000000", "654321", PinKind::Pin6, FAST), Err(AppError::AuthFailed(_))));
    assert!(matches!(v.change_pin(PIN, "12345", PinKind::Pin6, FAST), Err(AppError::Invalid(_))));
    assert!(matches!(v.change_pin(PIN, "una frase larga", PinKind::Pin6, FAST), Err(AppError::Invalid(_))));
    v.change_pin(PIN, "654321", PinKind::Pin6, FAST).unwrap();
    assert!(!v.status().locked, "sigue desbloqueada");
    assert_eq!(get(&v, "a").unwrap().as_deref(), Some("1"));

    let after: Envelope = serde_json::from_str(&fs::read_to_string(dir.vault_path()).unwrap()).unwrap();
    let old: Envelope = serde_json::from_str(&before).unwrap();
    assert_ne!(after.kdf.salt, old.kdf.salt, "sal nueva");

    let v2 = dir.vault();
    assert!(matches!(v2.unlock(PIN), Err(AppError::AuthFailed(_))));
    v2.unlock("654321").unwrap();
    assert_eq!(get(&v2, "a").unwrap().as_deref(), Some("1"));
}

#[test]
fn pin_rules() {
    // Válidos: exactamente 6 números.
    for ok in ["123456", "000000", "987654"] {
        assert!(check_new_pin(ok).is_ok(), "{ok}");
    }
    // Inválidos: más corto, más largo, letras, espacios, signos o números no ASCII.
    for bad in ["", "12345", "1234567", "12345a", "12 456", " 123456", "123456 ", "+12345", "١٢٣٤٥٦", "      ", "una frase larga"] {
        assert!(matches!(check_new_pin(bad), Err(AppError::Invalid(_))), "«{bad}»");
    }
    let dir = TempDir::new();
    assert!(matches!(dir.vault().create("123", PinKind::Pin6, BTreeMap::new(), FAST), Err(AppError::Invalid(_))));
    assert!(matches!(dir.vault().create("abcdef", PinKind::Pin6, BTreeMap::new(), FAST), Err(AppError::Invalid(_))));
    assert!(!dir.vault_path().exists());
    assert!(dir.1.key().is_none(), "ni siquiera se crea la llave del equipo");
    // El enlace con el llavero también lo comprueba.
    let kr = FakeKeyring::default();
    assert!(matches!(secrets::enable_vault(&dir.vault(), &kr, &[], "frase", PinKind::Pin6, FAST), Err(AppError::Invalid(_))));
}

#[test]
fn new_vault_is_pin6_in_authenticated_header() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    assert_eq!(v.status().pin_kind, PinKind::Pin6);
    let env: Envelope = serde_json::from_str(&fs::read_to_string(dir.vault_path()).unwrap()).unwrap();
    assert_eq!(env.kind.as_deref(), Some("pin6"));
    let v2 = dir.vault();
    assert_eq!(v2.status(), VaultStatus { pin_kind: PinKind::Pin6, ..status(true, true) });

    // Cambiar o quitar la etiqueta rompe la cabecera autenticada: no abre ni con el PIN.
    for edit in [
        (|j: &mut serde_json::Value| j["kind"] = "text".into()) as fn(&mut serde_json::Value),
        |j| {
            j.as_object_mut().unwrap().remove("kind");
        },
        |j| j["kind"] = "pin6/x".into(),
    ] {
        let dir = TempDir::new();
        dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
        tamper(&dir, edit);
        let v = dir.vault();
        let r = v.unlock(PIN);
        assert!(matches!(r, Err(AppError::AuthFailed(_)) | Err(AppError::Invalid(_))), "{r:?}");
        assert!(v.status().locked);
    }
}

// ───────── Bóvedas antiguas (PIN o contraseña de texto, sin etiqueta) ─────────

#[test]
fn legacy_text_vault_still_opens() {
    let dir = TempDir::new();
    let old = "mi contraseña maestra";
    write_legacy(&dir, old, &[("srv-1", "p1")]);

    let v = dir.vault();
    let st = v.status();
    assert!(st.enabled && st.locked);
    assert_eq!(st.pin_kind, PinKind::Text, "se pide con un campo de texto");
    assert!(matches!(v.unlock("123456"), Err(AppError::AuthFailed(_))));
    v.unlock(old).unwrap();
    assert_eq!(get(&v, "srv-1").unwrap().as_deref(), Some("p1"));

    // Guardar algo la mantiene de tipo texto (y se sigue abriendo con lo mismo).
    v.set("srv-2", "p2").unwrap().unwrap();
    let env: Envelope = serde_json::from_str(&fs::read_to_string(dir.vault_path()).unwrap()).unwrap();
    assert_eq!(env.kind.as_deref(), Some("text"));
    let v2 = dir.vault();
    assert_eq!(v2.status().pin_kind, PinKind::Text);
    v2.unlock(old).unwrap();
    assert_eq!(get(&v2, "srv-2").unwrap().as_deref(), Some("p2"));

    // Al cambiar el PIN, el nuevo es de 6 números (texto no vale) y la bóveda pasa a "pin6".
    assert!(matches!(v2.change_pin(old, "otra frase", PinKind::Pin6, FAST), Err(AppError::Invalid(_))));
    v2.change_pin(old, "246810", PinKind::Pin6, FAST).unwrap();
    assert_eq!(v2.status().pin_kind, PinKind::Pin6);
    let v3 = dir.vault();
    assert_eq!(v3.status().pin_kind, PinKind::Pin6);
    assert!(matches!(v3.unlock(old), Err(AppError::AuthFailed(_))));
    v3.unlock("246810").unwrap();
    assert_eq!(get(&v3, "srv-1").unwrap().as_deref(), Some("p1"));
}

#[test]
fn legacy_text_vault_can_be_disabled_with_its_text() {
    let dir = TempDir::new();
    write_legacy(&dir, "frase vieja", &[("s1", "p1"), ("s1:sudo", "ps")]);
    let v = dir.vault();
    let kr = FakeKeyring::default();
    secrets::disable_vault(&v, &kr, "frase vieja").unwrap();
    assert_eq!(*kr.data.borrow(), map(&[("s1", "p1"), ("s1:sudo", "ps")]));
    assert_eq!(v.status(), status(false, false));
}

#[test]
fn check_pin_counts_as_attempt() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    v.check_pin(PIN).unwrap();
    assert!(!v.status().locked, "comprobar no bloquea ni desbloquea");
    for _ in 0..5 {
        assert!(matches!(v.check_pin("999999"), Err(AppError::AuthFailed(_))));
    }
    assert!(matches!(v.check_pin("999999"), Err(AppError::AuthFailed(_))));
    assert!(v.status().retry_after_secs > 0, "misma espera que al desbloquear");
    assert!(matches!(v.check_pin(PIN), Err(AppError::Invalid(_))));
    // Sin bóveda no hay PIN que comprobar.
    let other = TempDir::new();
    assert!(matches!(other.vault().check_pin(PIN), Err(AppError::Invalid(_))));
}

#[test]
fn create_twice_fails() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, BTreeMap::new(), FAST).unwrap();
    assert!(v.create(PIN, PinKind::Pin6, BTreeMap::new(), FAST).is_err());
    // Un archivo que ya existe tampoco se pisa.
    assert!(dir.vault().create(PIN, PinKind::Pin6, BTreeMap::new(), FAST).is_err());
}
