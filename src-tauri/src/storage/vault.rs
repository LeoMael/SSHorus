//! Bóveda de contraseñas: las contraseñas y frases guardadas (de conexión y de sudo, y el token de
//! GitHub) cifradas con una llave que sale del PIN o la contraseña del usuario Y de una llave de
//! este equipo. En el código, «pin» es lo que se escribe para abrir, sea PIN o contraseña.
//!
//! - Archivo: `vault.json` en la carpeta de configuración (escritura atómica, permisos 0600).
//!   Es un sobre de `storage::cipher` (AES-256-GCM + Argon2id) con formato "sshorus-vault".
//!   Dentro, cifrado: `{ "secrets": { "<id>": "<secreto>", … } }`. Leer y escribir: `vault_file`.
//! - El usuario elige PIN de 6 números o contraseña de 8 caracteres o más (`vault_kind`). El tipo
//!   va en la cabecera autenticada del sobre (`kind`), sin secretos, para saber qué pedir antes de
//!   desbloquear. Las bóvedas sin etiqueta (antiguas) se abren con un campo de texto ("text").
//!   Con la llave del equipo, 6 números bastan contra la copia del archivo: sin ella no se puede
//!   probar ningún PIN, y las esperas tras fallos frenan a quien está delante del PC.
//! - Llave del equipo: 32 bytes al azar guardados en el llavero del sistema (usuario
//!   `vault-device-key`). Entra en Argon2id como su «secreto» (K), así que la llave de la bóveda
//!   sale del PIN y de ella juntos: quien se lleve solo `vault.json` no puede probar PIN fuera de
//!   este equipo. Si falta (otro PC, llavero borrado), la bóveda no se puede abrir: solo queda
//!   «Olvidé mi PIN». Desactivar la bóveda y «Olvidé mi PIN» también la borran.
//! - Estados: `Disabled` (no hay bóveda: los secretos van al llavero del sistema), `Locked`
//!   (hay bóveda pero no se escribió el PIN) y `Unlocked` (llave y secretos en memoria).
//! - Al bloquear se sueltan la llave y los secretos; `Zeroizing` los pisa con ceros.
//! - La llave se queda en memoria mientras está desbloqueada para poder guardar secretos nuevos
//!   sin volver a pedir el PIN (cada guardado usa un nonce nuevo).
//! - Fallos: 5 libres y luego esperas crecientes (`vault_attempts`). Nunca se borra nada por fallar.
//!
//! Independiente de Tauri: `storage::lock` pone los comandos, el bloqueo por inactividad y los
//! avisos a las ventanas.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::Serialize;
use zeroize::Zeroizing;

use super::cipher::{self, KdfParams};
use super::fsutil;
use crate::error::{AppError, AppResult};

#[path = "vault_attempts.rs"]
mod attempts;
#[path = "vault_file.rs"]
mod file;
#[path = "vault_kind.rs"]
mod kind;

pub use attempts::ATTEMPTS_FILE;
pub use file::{calibrate, DeviceKeyStore};
pub use kind::{check_new_secret, PinKind};
use attempts::Throttle;
use file::{
    load_device_key, open_with_pin, read_envelope, seal_new, write_file, write_verified, Open, Secrets,
    DEVICE_KEY_LEN,
};
#[cfg(test)]
use {
    attempts::delay_after,
    cipher::Envelope,
    file::{FORMAT, VERSION},
    kind::{check_new_password, check_new_pin},
};

pub const FILE_NAME: &str = "vault.json";
/// Usuario del llavero donde va la llave de este equipo.
pub const DEVICE_KEY_USER: &str = "vault-device-key";

/// Lo que ve la interfaz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// Hay bóveda (si no, los secretos van al llavero del sistema).
    pub enabled: bool,
    /// Hay bóveda y falta el PIN o la contraseña.
    pub locked: bool,
    /// Segundos que faltan para poder volver a probar (0 = ya).
    pub retry_after_secs: u32,
    /// Qué pedir al desbloquear: PIN, contraseña o texto (sin bóveda: "pin6").
    pub pin_kind: PinKind,
}

enum State {
    Disabled,
    Locked,
    Unlocked(Open),
}

pub struct Vault {
    /// None si el sistema no tiene carpeta de configuración (bóveda imposible).
    path: Option<PathBuf>,
    device: Box<dyn DeviceKeyStore>,
    state: Mutex<State>,
    /// PIN o contraseña (se sabe sin desbloquear: va en la cabecera del archivo).
    pin_kind: Mutex<PinKind>,
    throttle: Throttle,
    /// Una operación larga a la vez (crear, desbloquear, cambiar PIN, desactivar, olvidar).
    ops: Mutex<()>,
}

fn guard<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl Vault {
    /// Bóveda en esa ruta: bloqueada si el archivo existe, desactivada si no. Los fallos se leen
    /// de `vault-attempts.json` en la misma carpeta.
    pub fn new(path: Option<PathBuf>, device: Box<dyn DeviceKeyStore>) -> Self {
        let state = match &path {
            Some(p) if p.exists() => State::Locked,
            _ => State::Disabled,
        };
        // El tipo se lee de la cabecera; si el archivo está dañado, texto libre (al desbloquear
        // se verá el error).
        let pin_kind = match (&state, &path) {
            (State::Locked, Some(p)) => read_envelope(p).map_or(PinKind::Text, |e| PinKind::from_envelope(&e)),
            _ => PinKind::Pin6,
        };
        let throttle = Throttle::load(path.as_ref().map(|p| p.with_file_name(ATTEMPTS_FILE)));
        Vault {
            path,
            device,
            state: Mutex::new(state),
            pin_kind: Mutex::new(pin_kind),
            throttle,
            ops: Mutex::new(()),
        }
    }

    /// La bóveda de la app (`~/.config/sshorus/vault.json`, llave del equipo en el llavero).
    pub fn global() -> &'static Vault {
        static G: OnceLock<Vault> = OnceLock::new();
        G.get_or_init(|| {
            Vault::new(
                fsutil::config_dir().map(|d| d.join(FILE_NAME)),
                Box::new(super::secrets::KeyringDeviceKey(super::secrets::SERVICE)),
            )
        })
    }

    fn path(&self) -> AppResult<&Path> {
        self.path
            .as_deref()
            .ok_or_else(|| AppError::Io("no se encontró la carpeta de configuración del usuario".into()))
    }

    pub fn status(&self) -> VaultStatus {
        let (enabled, locked) = match &*guard(&self.state) {
            State::Disabled => (false, false),
            State::Locked => (true, true),
            State::Unlocked(_) => (true, false),
        };
        VaultStatus {
            enabled,
            locked,
            retry_after_secs: self.throttle.retry_after().map_or(0, |d| d.as_secs_f64().ceil() as u32),
            pin_kind: if enabled { *guard(&self.pin_kind) } else { PinKind::Pin6 },
        }
    }

    /// PIN o contraseña (sin bóveda: PIN).
    pub fn pin_kind(&self) -> PinKind {
        self.status().pin_kind
    }

    pub fn is_enabled(&self) -> bool {
        !matches!(*guard(&self.state), State::Disabled)
    }

    // ───────── Secretos (None = bóveda desactivada: usar el llavero) ─────────

    pub fn get(&self, id: &str) -> Option<AppResult<Option<String>>> {
        match &*guard(&self.state) {
            State::Disabled => None,
            State::Locked => Some(Err(AppError::Locked)),
            State::Unlocked(o) => Some(Ok(o.secrets.get(id).map(|s| s.to_string()))),
        }
    }

    pub fn set(&self, id: &str, secret: &str) -> Option<AppResult<()>> {
        self.modify(|m| {
            m.insert(id.to_string(), Zeroizing::new(secret.to_string()));
        })
    }

    pub fn delete(&self, id: &str) -> Option<AppResult<()>> {
        self.modify(|m| {
            m.remove(id);
        })
    }

    /// Cambia una copia de los secretos, la escribe y solo entonces la publica.
    fn modify(&self, f: impl FnOnce(&mut Secrets)) -> Option<AppResult<()>> {
        let mut st = guard(&self.state);
        let open = match &mut *st {
            State::Disabled => return None,
            State::Locked => return Some(Err(AppError::Locked)),
            State::Unlocked(o) => o,
        };
        let mut next = open.secrets.clone();
        f(&mut next);
        if next == open.secrets {
            return Some(Ok(()));
        }
        let r = self.path().and_then(|p| write_file(p, open, &next));
        if r.is_ok() {
            open.secrets = next;
        }
        Some(r)
    }

    /// Ids con secreto (solo desbloqueada).
    #[cfg(test)]
    pub fn ids(&self) -> AppResult<Vec<String>> {
        match &*guard(&self.state) {
            State::Disabled => Ok(Vec::new()),
            State::Locked => Err(AppError::Locked),
            State::Unlocked(o) => Ok(o.secrets.keys().cloned().collect()),
        }
    }

    // ───────── Bloqueo ─────────

    /// Bloquea: suelta (y pisa con ceros) la llave y los secretos. Devuelve si cambió algo.
    pub fn lock(&self) -> bool {
        let mut st = guard(&self.state);
        if matches!(*st, State::Unlocked(_)) {
            *st = State::Locked;
            true
        } else {
            false
        }
    }

    pub fn is_unlocked(&self) -> bool {
        matches!(*guard(&self.state), State::Unlocked(_))
    }

    fn require_enabled(&self) -> AppResult<()> {
        if self.is_enabled() {
            Ok(())
        } else {
            Err(AppError::Invalid("no hay ninguna bóveda creada".into()))
        }
    }

    /// Abre el archivo con el PIN o la contraseña (con la espera tras fallos).
    fn verify_pin(&self, pin: &str) -> AppResult<Open> {
        self.throttle.check()?;
        let r = open_with_pin(self.path()?, pin, &*self.device);
        self.throttle.note(&r);
        r
    }

    /// Desbloquea con el PIN o la contraseña. Si ya estaba desbloqueada no hace nada.
    pub fn unlock(&self, pin: &str) -> AppResult<()> {
        let _op = guard(&self.ops);
        match *guard(&self.state) {
            State::Disabled => return Err(AppError::Invalid("no hay ninguna bóveda creada".into())),
            State::Unlocked(_) => return Ok(()),
            State::Locked => {}
        }
        let open = self.verify_pin(pin)?;
        let mut st = guard(&self.state);
        if matches!(*st, State::Locked) {
            *st = State::Unlocked(open);
        }
        Ok(())
    }

    /// Comprueba el PIN o la contraseña sin cambiar nada (p. ej. antes de mostrar una contraseña
    /// guardada). Cuenta como intento: los fallos tienen la misma espera que al desbloquear.
    pub fn check_pin(&self, pin: &str) -> AppResult<()> {
        let _op = guard(&self.ops);
        self.require_enabled()?;
        self.verify_pin(pin).map(|_| ())
    }

    // ───────── Crear, cambiar PIN, desactivar, olvidar ─────────

    /// Crea la bóveda con esos secretos, protegida con un PIN o una contraseña (`kind`), y la deja
    /// desbloqueada. Escribe el archivo y comprueba que se vuelve a abrir antes de dar nada por
    /// hecho; si algo falla, no queda archivo.
    pub fn create(
        &self,
        pin: &str,
        kind: PinKind,
        secrets: BTreeMap<String, String>,
        params: KdfParams,
    ) -> AppResult<()> {
        check_new_secret(pin, kind)?;
        let _op = guard(&self.ops);
        let path = self.path()?.to_path_buf();
        if !matches!(*guard(&self.state), State::Disabled) || path.exists() {
            return Err(AppError::Invalid("ya hay una bóveda creada".into()));
        }
        // Llave nueva de este equipo, al llavero antes que nada (si no hay llavero, no se crea nada).
        let dk = Zeroizing::new(cipher::random::<DEVICE_KEY_LEN>()?);
        self.device.save(&dk[..]).map_err(|e| {
            let why = match e {
                AppError::Keyring(m) => m,
                other => other.to_string(),
            };
            AppError::Keyring(format!(
                "{} necesita el llavero del sistema para guardar la llave de este equipo: {why}",
                kind.noun()
            ))
        })?;
        let secrets = secrets.into_iter().map(|(k, v)| (k, Zeroizing::new(v))).collect();
        let built = seal_new(pin, kind, params, &dk[..], secrets).and_then(|open| {
            write_verified(&path, &open)?;
            Ok(open)
        });
        let open = match built {
            Ok(o) => o,
            Err(e) => {
                let _ = fs::remove_file(&path);
                let _ = self.device.delete();
                return Err(e);
            }
        };
        *guard(&self.pin_kind) = kind;
        *guard(&self.state) = State::Unlocked(open);
        Ok(())
    }

    /// Cambia el PIN o la contraseña, o pasa de uno a otro (`new_kind`): vuelve a cifrar con sal y
    /// llave nuevas. Pide el actual (de cualquier tipo).
    pub fn change_pin(&self, old: &str, new: &str, new_kind: PinKind, params: KdfParams) -> AppResult<()> {
        check_new_secret(new, new_kind)?;
        let _op = guard(&self.ops);
        self.require_enabled()?;
        let path = self.path()?.to_path_buf();
        let from_file = self.verify_pin(old)?;
        let dk = load_device_key(&*self.device)?;
        // Con el estado tomado: así no se pierde un secreto guardado mientras tanto.
        let mut st = guard(&self.state);
        let secrets = match &*st {
            State::Unlocked(o) => o.secrets.clone(),
            _ => from_file.secrets,
        };
        let open = seal_new(new, new_kind, params, &dk, secrets)?;
        write_verified(&path, &open)?;
        *guard(&self.pin_kind) = new_kind;
        // Si se bloqueó mientras tanto, sigue bloqueada (el archivo ya tiene el PIN nuevo).
        if matches!(*st, State::Unlocked(_)) {
            *st = State::Unlocked(open);
        }
        Ok(())
    }

    /// Comprueba el PIN o la contraseña y devuelve todos los secretos (para devolverlos al llavero).
    pub fn export_with_pin(&self, pin: &str) -> AppResult<BTreeMap<String, Zeroizing<String>>> {
        let _op = guard(&self.ops);
        self.require_enabled()?;
        let from_file = self.verify_pin(pin)?;
        Ok(match &*guard(&self.state) {
            State::Unlocked(o) => o.secrets.clone(),
            _ => from_file.secrets,
        })
    }

    /// Borra el archivo y la llave del equipo, y vuelve al llavero del sistema. Se usa al
    /// desactivar (tras copiar los secretos al llavero) y en «Olvidé mi PIN» (se pierden).
    pub fn remove(&self) -> AppResult<()> {
        let _op = guard(&self.ops);
        let path = self.path()?;
        match fs::remove_file(path) {
            Ok(()) => fsutil::sync_dir(path.parent().unwrap_or(Path::new("."))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::Io(format!("no se pudo borrar {}: {e}", path.display()))),
        }
        *guard(&self.state) = State::Disabled;
        *guard(&self.pin_kind) = PinKind::Pin6;
        // Sin bóveda la llave del equipo no sirve para nada (si el llavero no responde, se queda).
        if let Err(e) = self.device.delete() {
            log::warn!("bóveda: no se pudo borrar la llave del equipo del llavero: {e}");
        }
        self.throttle.reset();
        Ok(())
    }
}

#[cfg(test)]
#[path = "vault_tests.rs"]
mod tests;
