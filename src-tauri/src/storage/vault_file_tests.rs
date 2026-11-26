//! Tests de la bóveda: archivo dañado o manipulado, espera tras fallos, llave del equipo,
//! «Olvidé mi PIN», permisos y calibración.

use super::*;

// ───────── Archivo dañado o manipulado ─────────

#[test]
fn damaged_file_fails_cleanly() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();

    fs::write(dir.vault_path(), b"{ esto no es json").unwrap();
    let v = dir.vault();
    assert!(matches!(v.unlock(PIN), Err(AppError::Invalid(_))));
    assert!(v.status().locked);
    // Nunca se borra ni se aparta el archivo por estar dañado.
    assert_eq!(fs::read(dir.vault_path()).unwrap(), b"{ esto no es json");
}

#[test]
fn tampered_header_or_data_fails() {
    type Edit = fn(&mut serde_json::Value);
    let cases: &[(&str, Edit)] = &[
        ("pasadas", |v| v["kdf"]["t"] = 2.into()),
        ("memoria", |v| v["kdf"]["mKib"] = 512.into()),
        ("sal", |v| v["kdf"]["salt"] = "AAAAAAAAAAAAAAAAAAAAAA==".into()),
        ("formato", |v| v["format"] = "sshorus-sync".into()),
        ("versión", |v| v["version"] = 2.into()),
        ("memoria enorme", |v| v["kdf"]["mKib"] = (10u64 * 1024 * 1024).into()),
        ("nonce", |v| v["nonce"] = "AAAA".into()),
        ("datos", |v| {
            let d = v["data"].as_str().unwrap().to_string();
            let mut b = d.into_bytes();
            b[4] = if b[4] == b'A' { b'B' } else { b'A' };
            v["data"] = String::from_utf8(b).unwrap().into();
        }),
    ];
    for (name, edit) in cases {
        let dir = TempDir::new();
        dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
        tamper(&dir, *edit);
        let v = dir.vault();
        let r = v.unlock(PIN);
        assert!(
            matches!(r, Err(AppError::Invalid(_)) | Err(AppError::AuthFailed(_))),
            "{name}: {r:?}"
        );
        assert!(v.status().locked, "{name}");
        assert!(dir.vault_path().exists(), "{name}: el archivo no se toca");
    }
}

// ───────── Espera tras fallos ─────────

#[test]
fn growing_delay_after_failures() {
    assert_eq!(delay_after(0), Duration::ZERO);
    assert_eq!(delay_after(5), Duration::ZERO, "5 fallos libres");
    assert_eq!(delay_after(6), Duration::from_secs(30));
    assert_eq!(delay_after(7), Duration::from_secs(60));
    assert_eq!(delay_after(9), Duration::from_secs(240));
    assert_eq!(delay_after(10), Duration::from_secs(480));
    assert_eq!(delay_after(11), Duration::from_secs(900), "máximo 15 min");
    assert_eq!(delay_after(500), Duration::from_secs(900));

    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let v = dir.vault();
    for _ in 0..5 {
        assert!(matches!(v.unlock("999999"), Err(AppError::AuthFailed(_))));
        assert_eq!(v.status().retry_after_secs, 0);
    }
    assert!(matches!(v.unlock("999999"), Err(AppError::AuthFailed(_))));
    let wait = v.status().retry_after_secs;
    assert!((29..=30).contains(&wait), "{wait}");
    // Mientras tanto ni el PIN correcto se prueba (y no se borra nada).
    assert!(matches!(v.unlock(PIN), Err(AppError::Invalid(_))));
    assert!(dir.vault_path().exists());

    // Reiniciar la app no borra la espera: está en disco.
    assert!(dir.0.join(ATTEMPTS_FILE).exists());
    let v2 = dir.vault();
    assert!(v2.status().retry_after_secs >= 29);
    assert!(matches!(v2.unlock(PIN), Err(AppError::Invalid(_))));

    // «Olvidé mi PIN» quita la espera y el archivo de intentos.
    v2.remove().unwrap();
    assert_eq!(v2.status().retry_after_secs, 0);
    assert!(!dir.0.join(ATTEMPTS_FILE).exists());
}

#[test]
fn success_resets_failures() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let v = dir.vault();
    for _ in 0..4 {
        let _ = v.unlock("999999");
    }
    v.unlock(PIN).unwrap();
    assert!(!dir.0.join(ATTEMPTS_FILE).exists());
    v.lock();
    // Vuelve a tener 5 fallos libres.
    for _ in 0..5 {
        let _ = v.unlock("999999");
    }
    assert_eq!(v.status().retry_after_secs, 0);
}

// ───────── Llave del equipo ─────────

#[test]
fn device_key_is_created_and_required() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let key = dir.1.key().expect("se guarda una llave del equipo");
    assert_eq!(key.len(), 32);

    // Sin la llave del equipo (otro PC, llavero borrado): no abre ni con el PIN correcto,
    // y no cuenta como fallo de PIN.
    dir.1.put(None);
    let v = dir.vault();
    let err = v.unlock(PIN).unwrap_err();
    assert!(matches!(&err, AppError::Invalid(m) if m.contains("llave de este equipo")), "{err:?}");
    assert!(!dir.0.join(ATTEMPTS_FILE).exists());

    // PIN correcto con OTRA llave del equipo: tampoco.
    dir.1.put(Some(vec![7u8; 32]));
    assert!(matches!(v.unlock(PIN), Err(AppError::AuthFailed(_))));

    // Con la suya, sí.
    dir.1.put(Some(key));
    v.unlock(PIN).unwrap();
    assert_eq!(get(&v, "a").unwrap().as_deref(), Some("1"));
}

#[test]
fn copied_file_is_useless_on_another_device() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    // «Otro PC»: mismo archivo, llavero distinto (con su propia bóveda creada antes).
    let other = TempDir::new();
    other.vault().create("135790", PinKind::Pin6, BTreeMap::new(), FAST).unwrap();
    fs::copy(dir.vault_path(), other.vault_path()).unwrap();
    assert!(matches!(other.vault().unlock(PIN), Err(AppError::AuthFailed(_))));
}

#[test]
fn reset_and_disable_delete_device_key() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, BTreeMap::new(), FAST).unwrap();
    assert!(dir.1.key().is_some());
    v.remove().unwrap();
    assert!(dir.1.key().is_none(), "«Olvidé mi PIN» la borra");

    v.create(PIN, PinKind::Pin6, map(&[("s1", "p1")]), FAST).unwrap();
    let kr = FakeKeyring::default();
    secrets::disable_vault(&v, &kr, PIN).unwrap();
    assert!(dir.1.key().is_none(), "desactivar la borra");
}

#[test]
fn change_pin_keeps_device_binding() {
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    v.change_pin(PIN, "654321", PinKind::Pin6, FAST).unwrap();
    dir.1.put(Some(vec![1u8; 32]));
    assert!(matches!(dir.vault().unlock("654321"), Err(AppError::AuthFailed(_))));
}

// ───────── «Olvidé mi PIN» ─────────

#[test]
fn reset_removes_vault_and_falls_back_to_keyring() {
    let dir = TempDir::new();
    dir.vault().create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let v = dir.vault();
    assert!(v.status().locked);
    v.remove().unwrap();
    assert!(!dir.vault_path().exists());
    assert_eq!(v.status(), status(false, false));
    assert!(v.get("a").is_none(), "vuelve al llavero");
    assert!(v.set("a", "x").is_none());
    // Se puede crear otra con un PIN nuevo; la anterior se perdió.
    v.create("135790", PinKind::Pin6, BTreeMap::new(), FAST).unwrap();
    assert_eq!(get(&v, "a").unwrap(), None);
    // Borrar sin archivo no es error.
    v.remove().unwrap();
    v.remove().unwrap();
}

// ───────── Permisos ─────────

#[cfg(unix)]
#[test]
fn file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new();
    let v = dir.vault();
    v.create(PIN, PinKind::Pin6, map(&[("a", "1")]), FAST).unwrap();
    let mode = fs::metadata(dir.vault_path()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    v.set("b", "2").unwrap().unwrap();
    v.change_pin(PIN, "999999", PinKind::Pin6, FAST).unwrap();
    let mode = fs::metadata(dir.vault_path()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

#[test]
fn calibration_stays_in_range() {
    let p = calibrate();
    let start = std::time::Instant::now();
    cipher::derive_key(PIN.as_bytes(), &[1u8; cipher::SALT_LEN], p).unwrap();
    eprintln!("calibrado: {p:?}, derivar tarda {:?}", start.elapsed());
    assert!(p.m_kib == 64 * 1024 || p.m_kib == 128 * 1024, "{p:?}");
    assert!((3..=20).contains(&p.t), "{p:?}");
    assert_eq!(p.p, 1);
}
