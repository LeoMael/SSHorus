//! Tests de mover secretos entre la bóveda y el llavero (de mentira y real, "sshorus-test") y de
//! los secretos de cada servidor.

use super::*;

#[test]
fn enable_moves_secrets_from_keyring() {
    let dir = TempDir::new();
    let v = dir.vault();
    let kr = FakeKeyring::default();
    kr.data.borrow_mut().extend(map(&[
        ("s1", "p1"),
        ("s2", "p2"),
        ("s2:sudo", "sudo2"),
        ("s3:sudo", "sudo3"),
        ("x:sudo", "de otro"),
        ("github-token", "ghp"),
        ("mcp-token", "mcp"),
        ("ai-token", "sk-ia"),
        ("otra-app", "x"),
    ]));
    let r = secrets::enable_vault(&v, &kr, &ids(&["s1", "s2", "s3"]), PIN, PinKind::Pin6, FAST).unwrap();
    assert_eq!(r, MoveReport { moved: 7, left_in_keyring: 0 });
    // En el llavero solo queda lo que no es de un servidor conocido.
    assert_eq!(
        kr.data.borrow().keys().cloned().collect::<Vec<_>>(),
        vec!["otra-app".to_string(), "x:sudo".to_string()]
    );
    let v2 = dir.vault();
    v2.unlock(PIN).unwrap();
    assert_eq!(get(&v2, "s1").unwrap().as_deref(), Some("p1"));
    assert_eq!(get(&v2, "s2:sudo").unwrap().as_deref(), Some("sudo2"));
    assert_eq!(get(&v2, "s3:sudo").unwrap().as_deref(), Some("sudo3"));
    assert_eq!(get(&v2, "s1:sudo").unwrap(), None);
    assert_eq!(get(&v2, "github-token").unwrap().as_deref(), Some("ghp"));
    assert_eq!(get(&v2, "mcp-token").unwrap().as_deref(), Some("mcp"));
    assert_eq!(get(&v2, "ai-token").unwrap().as_deref(), Some("sk-ia"));
    assert_eq!(get(&v2, "s3").unwrap(), None);
}

#[test]
fn enable_aborts_without_losing_anything_if_keyring_fails() {
    let dir = TempDir::new();
    let v = dir.vault();
    let kr = FakeKeyring { fail_get: true, ..Default::default() };
    kr.data.borrow_mut().insert("s1".into(), "p1".into());
    assert!(secrets::enable_vault(&v, &kr, &ids(&["s1"]), PIN, PinKind::Pin6, FAST).is_err());
    assert!(!dir.vault_path().exists(), "no se crea la bóveda");
    assert!(!v.is_enabled());
    assert_eq!(kr.data.borrow().get("s1").map(String::as_str), Some("p1"));
}

#[test]
fn enable_keeps_copies_if_keyring_cannot_delete() {
    let dir = TempDir::new();
    let v = dir.vault();
    let kr = FakeKeyring { fail_delete: true, ..Default::default() };
    kr.data.borrow_mut().insert("s1".into(), "p1".into());
    let r = secrets::enable_vault(&v, &kr, &ids(&["s1"]), PIN, PinKind::Pin6, FAST).unwrap();
    assert_eq!(r, MoveReport { moved: 1, left_in_keyring: 1 });
    assert_eq!(get(&v, "s1").unwrap().as_deref(), Some("p1"));
}

#[test]
fn disable_returns_secrets_to_keyring() {
    let dir = TempDir::new();
    let v = dir.vault();
    let all = map(&[
        ("s1", "p1"),
        ("s1:sudo", "ps1"),
        ("github-token", "ghp"),
        ("mcp-token", "mcp"),
        ("ai-token", "sk-ia"),
    ]);
    v.create(PIN, PinKind::Pin6, all.clone(), FAST).unwrap();
    v.lock();
    let kr = FakeKeyring::default();

    // PIN incorrecto: nada cambia.
    assert!(matches!(secrets::disable_vault(&v, &kr, "000000"), Err(AppError::AuthFailed(_))));
    assert!(dir.vault_path().exists());
    assert!(kr.data.borrow().is_empty());

    let r = secrets::disable_vault(&v, &kr, PIN).unwrap();
    assert_eq!(r.moved, 5);
    assert!(!dir.vault_path().exists());
    assert!(!v.is_enabled());
    assert_eq!(*kr.data.borrow(), all);
}

#[test]
fn disable_keeps_vault_if_keyring_fails() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("s1", "p1")]), FAST).unwrap();
    let kr = FakeKeyring { fail_set: true, ..Default::default() };
    assert!(matches!(secrets::disable_vault(&v, &kr, PIN), Err(AppError::Keyring(_))));
    assert!(dir.vault_path().exists());
    assert!(v.is_enabled());
    assert_eq!(get(&v, "s1").unwrap().as_deref(), Some("p1"));
}

#[test]
fn forgot_pin_drops_sudo_secrets_too() {
    let dir = TempDir::new();
    let v = dir.vault();
    let kr = FakeKeyring::default();
    kr.data.borrow_mut().extend(map(&[("s1", "p1"), ("s1:sudo", "ps1")]));
    secrets::enable_vault(&v, &kr, &ids(&["s1"]), PIN, PinKind::Pin6, FAST).unwrap();
    assert!(kr.data.borrow().is_empty());
    v.lock();
    v.remove().unwrap();
    // Sin bóveda se lee del llavero: ya no hay nada, ni de conexión ni de sudo.
    for id in ["s1", "s1:sudo"] {
        assert_eq!(secrets::get_with(&v, &kr, id).unwrap(), None, "{id}");
    }
}

// ───────── Secretos de un servidor (conexión + sudo) ─────────

#[test]
fn sudo_ids_and_kinds() {
    assert_eq!(secrets::sudo_id("abc"), "abc:sudo");
    assert_eq!(secrets::SecretKind::Login.id("abc"), "abc");
    assert_eq!(secrets::SecretKind::Sudo.id("abc"), "abc:sudo");
    assert_eq!(
        secrets::server_secret_ids("abc"),
        ["abc".to_string(), "abc:sudo".to_string(), "abc:db".to_string()]
    );
}

#[test]
fn delete_and_copy_server_secrets_in_keyring() {
    let dir = TempDir::new();
    let v = dir.vault(); // sin bóveda: llavero
    let kr = FakeKeyring::default();
    kr.data
        .borrow_mut()
        .extend(map(&[("s1", "p1"), ("s1:sudo", "ps1"), ("s1:db", "{}"), ("s2", "p2"), ("s2:sudo", "ps2")]));

    secrets::copy_server_secrets_with(&v, &kr, "s1", "c1").unwrap();
    assert_eq!(secrets::get_with(&v, &kr, "c1").unwrap().as_deref(), Some("p1"));
    assert_eq!(secrets::get_with(&v, &kr, "c1:sudo").unwrap().as_deref(), Some("ps1"));
    assert_eq!(secrets::get_with(&v, &kr, "c1:db").unwrap().as_deref(), Some("{}"));

    secrets::delete_server_secrets_with(&v, &kr, "s1").unwrap();
    let left: Vec<String> = kr.data.borrow().keys().cloned().collect();
    assert_eq!(left, ["c1", "c1:db", "c1:sudo", "s2", "s2:sudo"].map(String::from).to_vec());
    // Borrar lo que no existe no es error.
    secrets::delete_server_secrets_with(&v, &kr, "s1").unwrap();
}

#[test]
fn delete_and_copy_server_secrets_in_vault() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("s1", "p1"), ("s1:sudo", "ps1"), ("s2:sudo", "ps2")]), FAST).unwrap();
    let kr = FakeKeyring::default();

    // Solo sudo guardado (servidor con llave): se copia igual.
    secrets::copy_server_secrets_with(&v, &kr, "s2", "c2").unwrap();
    assert_eq!(get(&v, "c2").unwrap(), None);
    assert_eq!(get(&v, "c2:sudo").unwrap().as_deref(), Some("ps2"));

    secrets::delete_server_secrets_with(&v, &kr, "s1").unwrap();
    assert_eq!(v.ids().unwrap(), vec!["c2:sudo".to_string(), "s2:sudo".to_string()]);
    assert!(kr.data.borrow().is_empty(), "con bóveda no se toca el llavero");

    // Queda escrito en el archivo.
    let v2 = dir.vault();
    v2.unlock(PIN).unwrap();
    assert_eq!(get(&v2, "s1:sudo").unwrap(), None);
    assert_eq!(get(&v2, "c2:sudo").unwrap().as_deref(), Some("ps2"));

    // Bloqueada: no se puede borrar nada (y se avisa).
    v2.lock();
    assert!(matches!(secrets::delete_server_secrets_with(&v2, &kr, "s2"), Err(AppError::Locked)));
}

// ───────── Mover secretos: llavero real ("sshorus-test") ─────────

/// `cargo test --lib storage::vault -- --ignored --test-threads=1`
#[test]
#[ignore]
fn migration_with_real_keyring() {
    let kr = SystemKeyring("sshorus-test");
    let a = format!("test-{}", uuid::Uuid::new_v4());
    let b = format!("test-{}", uuid::Uuid::new_v4());
    if let Err(e) = kr.set(&a, "pa ñ") {
        eprintln!("Llavero no disponible, se omite: {e}");
        return;
    }
    kr.set(&b, "pb").unwrap();
    // Si hubiera un token de pruebas viejo, se limpia (no es de este test).
    let _ = kr.delete(secrets::GITHUB_TOKEN_USER);

    let dir = TempDir::new();
    // También la llave del equipo en el llavero real.
    let v = Vault::new(Some(dir.vault_path()), Box::new(secrets::KeyringDeviceKey("sshorus-test")));
    let r = secrets::enable_vault(&v, &kr, &[a.clone(), b.clone()], PIN, PinKind::Pin6, FAST).unwrap();
    assert!(kr.get(DEVICE_KEY_USER).unwrap().is_some(), "llave del equipo en el llavero");
    v.lock();
    v.unlock(PIN).unwrap();
    assert_eq!(r, MoveReport { moved: 2, left_in_keyring: 0 });
    assert_eq!(kr.get(&a).unwrap(), None, "ya no está en el llavero");
    assert_eq!(get(&v, &a).unwrap().as_deref(), Some("pa ñ"));

    v.lock();
    let r = secrets::disable_vault(&v, &kr, PIN).unwrap();
    assert_eq!(r.moved, 2);
    assert!(!dir.vault_path().exists());
    assert_eq!(kr.get(DEVICE_KEY_USER).unwrap(), None, "la llave del equipo se borra");
    assert_eq!(kr.get(&a).unwrap().as_deref(), Some("pa ñ"));
    assert_eq!(kr.get(&b).unwrap().as_deref(), Some("pb"));

    let users: BTreeSet<&str> = [a.as_str(), b.as_str()].into();
    for u in users {
        kr.delete(u).unwrap();
    }
}
