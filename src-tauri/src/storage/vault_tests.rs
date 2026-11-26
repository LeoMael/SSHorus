//! Tests de la bóveda de contraseñas y de mover secretos entre ella y el llavero.
//! Los que usan el llavero real (servicio "sshorus-test") van con `#[ignore]`:
//! `cargo test --lib storage::vault -- --ignored --test-threads=1`

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::*;
use crate::storage::secrets::{self, Keyring, MoveReport, SystemKeyring};

/// Parámetros ligeros para que los tests no tarden.
const FAST: KdfParams = KdfParams {
    m_kib: 256,
    t: 1,
    p: 1,
};
const PIN: &str = "123456";

/// Llave del equipo en memoria (compartida entre las instancias de un mismo «equipo»).
#[derive(Clone, Default)]
struct FakeDevice(Arc<Mutex<Option<Vec<u8>>>>);

impl FakeDevice {
    fn key(&self) -> Option<Vec<u8>> {
        self.0.lock().unwrap().clone()
    }
    fn put(&self, k: Option<Vec<u8>>) {
        *self.0.lock().unwrap() = k;
    }
}

impl DeviceKeyStore for FakeDevice {
    fn load(&self) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.key().map(Zeroizing::new))
    }
    fn save(&self, key: &[u8]) -> AppResult<()> {
        self.put(Some(key.to_vec()));
        Ok(())
    }
    fn delete(&self) -> AppResult<()> {
        self.put(None);
        Ok(())
    }
}

/// Carpeta temporal propia (se borra al final) y la llave de «este equipo».
struct TempDir(PathBuf, FakeDevice);

impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("sshorus-vault-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        TempDir(p, FakeDevice::default())
    }
    fn vault_path(&self) -> PathBuf {
        self.0.join(FILE_NAME)
    }
    fn vault(&self) -> Vault {
        Vault::new(Some(self.vault_path()), Box::new(self.1.clone()))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

fn get(v: &Vault, id: &str) -> AppResult<Option<String>> {
    v.get(id).expect("la bóveda debería estar activa")
}

/// Estado sin esperas y con PIN de 6 números.
fn status(enabled: bool, locked: bool) -> VaultStatus {
    VaultStatus { enabled, locked, retry_after_secs: 0, pin_kind: PinKind::Pin6 }
}

// ───────── Mover secretos: llavero de mentira ─────────

#[derive(Default)]
struct FakeKeyring {
    data: RefCell<BTreeMap<String, String>>,
    fail_get: bool,
    fail_set: bool,
    fail_delete: bool,
}

impl Keyring for FakeKeyring {
    fn get(&self, user: &str) -> AppResult<Option<String>> {
        if self.fail_get {
            return Err(AppError::Keyring("se negó el acceso".into()));
        }
        Ok(self.data.borrow().get(user).cloned())
    }
    fn set(&self, user: &str, secret: &str) -> AppResult<()> {
        if self.fail_set {
            return Err(AppError::Keyring("se negó el acceso".into()));
        }
        self.data.borrow_mut().insert(user.into(), secret.into());
        Ok(())
    }
    fn delete(&self, user: &str) -> AppResult<()> {
        if self.fail_delete {
            return Err(AppError::Keyring("se negó el acceso".into()));
        }
        self.data.borrow_mut().remove(user);
        Ok(())
    }
}

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn tamper(dir: &TempDir, f: impl FnOnce(&mut serde_json::Value)) {
    let mut v: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.vault_path()).unwrap()).unwrap();
    f(&mut v);
    fs::write(dir.vault_path(), serde_json::to_vec(&v).unwrap()).unwrap();
}

/// Escribe una bóveda como las de antes: sin `kind` y con un secreto de texto libre.
fn write_legacy(dir: &TempDir, pin: &str, secrets: &[(&str, &str)]) {
    let dk = cipher::random::<32>().unwrap();
    dir.1.put(Some(dk.to_vec()));
    let salt = cipher::new_salt_b64().unwrap();
    let key = cipher::derive_key_keyed_b64(pin.as_bytes(), &salt, FAST, &dk).unwrap();
    let json = serde_json::to_vec(&serde_json::json!({ "secrets": map(secrets) })).unwrap();
    let env = cipher::seal(FORMAT, VERSION, &key, FAST, &salt, &json).unwrap();
    assert!(env.kind.is_none());
    fs::write(dir.vault_path(), serde_json::to_vec(&env).unwrap()).unwrap();
}

#[path = "vault_password_tests.rs"]
mod password;

#[path = "vault_pin_tests.rs"]
mod pin;

#[path = "vault_file_tests.rs"]
mod file;

#[path = "vault_move_tests.rs"]
mod moving;
