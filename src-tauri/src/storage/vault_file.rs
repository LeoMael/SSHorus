//! El archivo de la bóveda (`vault.json`): calibrar Argon2id, derivar la llave del PIN o la
//! contraseña junto con la llave de este equipo, cifrar, escribir, leer y descifrar.
//! Sin estado: `vault` decide cuándo se usa cada cosa.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::kind::{wrong_secret, PinKind, MAX_UNLOCK_LEN};
use crate::error::{AppError, AppResult};
use crate::storage::cipher::{self, EnvError, Envelope, KdfParams};
use crate::storage::fsutil;

pub const FORMAT: &str = "sshorus-vault";
pub const VERSION: u32 = 1;
pub(super) const DEVICE_KEY_LEN: usize = 32;
/// Qué hacer si se olvidó (botón de la pantalla de bloqueo, según el tipo).
const FORGOT: &str = "«Olvidé mi PIN» (o «Olvidé mi contraseña»)";

/// Memoria de Argon2id: 64 MiB (como la copia sincronizada); 128 MiB en equipos rápidos.
const BASE_M_KIB: u32 = 64 * 1024;
const MAX_M_KIB: u32 = 128 * 1024;
/// Pasadas mínimas y máximas al calibrar.
const MIN_T: u32 = 3;
const MAX_T: u32 = 20;
/// Con más pasadas que esto, mejor más memoria (frena más a quien adivina con tarjetas gráficas).
const PREFER_MORE_MEMORY_FROM_T: f64 = 10.0;
/// Tiempo buscado para derivar la llave al desbloquear.
const TARGET: Duration = Duration::from_millis(750);

/// Parámetros si no se puede medir: los de la copia sincronizada.
pub const FALLBACK_KDF: KdfParams = KdfParams {
    m_kib: BASE_M_KIB,
    t: MIN_T,
    p: 1,
};

/// Mide Argon2id en este equipo y elige memoria y pasadas para que desbloquear tarde unos
/// 0,75 s: 64 MiB (128 MiB si el equipo es rápido) y entre 3 y 20 pasadas. Los parámetros quedan
/// guardados en el archivo, así que desbloquear siempre usa los mismos.
pub fn calibrate() -> KdfParams {
    let probe = KdfParams {
        m_kib: BASE_M_KIB,
        t: 2,
        p: 1,
    };
    let start = Instant::now();
    if cipher::derive_key(b"calibrar", &[0u8; cipher::SALT_LEN], probe).is_err() {
        return FALLBACK_KDF;
    }
    // Dos pasadas para que el tiempo de reservar la memoria no pese tanto.
    let mut per_pass = start.elapsed().as_secs_f64() / 2.0;
    if per_pass <= 0.0 {
        return FALLBACK_KDF;
    }
    let target = TARGET.as_secs_f64();
    let mut m_kib = BASE_M_KIB;
    while target / per_pass > PREFER_MORE_MEMORY_FROM_T && m_kib < MAX_M_KIB {
        m_kib *= 2;
        per_pass *= 2.0;
    }
    let t = (target / per_pass).round() as u32;
    KdfParams {
        m_kib,
        t: t.clamp(MIN_T, MAX_T),
        p: 1,
    }
}

pub(super) type Secrets = BTreeMap<String, Zeroizing<String>>;

/// Contenido cifrado del archivo.
#[derive(Serialize, Deserialize, Default)]
struct Contents {
    #[serde(default)]
    secrets: BTreeMap<String, String>,
}

/// Igual que `Contents` pero prestado (sin copiar los secretos al escribir).
#[derive(Serialize)]
struct ContentsRef<'a> {
    secrets: BTreeMap<&'a str, &'a str>,
}

/// Bóveda abierta: solo existe mientras está desbloqueada.
pub(super) struct Open {
    pub(super) key: Zeroizing<[u8; 32]>,
    pub(super) params: KdfParams,
    pub(super) salt_b64: String,
    pub(super) kind: PinKind,
    pub(super) secrets: Secrets,
}

/// Dónde vive la llave de este equipo (el llavero del sistema; en tests, memoria).
pub trait DeviceKeyStore: Send + Sync {
    fn load(&self) -> AppResult<Option<Zeroizing<Vec<u8>>>>;
    fn save(&self, key: &[u8]) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

fn missing_device_key() -> AppError {
    AppError::Invalid(format!(
        "falta la llave de este equipo en el llavero del sistema (¿la bóveda viene de otro PC o se \
         borró el llavero?). Sin ella no se puede abrir: usa {FORGOT} para empezar de cero"
    ))
}

fn env_error(e: EnvError) -> AppError {
    match e {
        EnvError::WrongFormat | EnvError::Damaged => AppError::Invalid(format!(
            "el archivo de la bóveda (vault.json) está dañado. Si no tienes copia, usa {FORGOT}"
        )),
        EnvError::Unsupported => AppError::Invalid(
            "la bóveda se creó con una versión de SSHorus más nueva; actualiza la app".into(),
        ),
        EnvError::OutOfRange => {
            AppError::Invalid("la bóveda tiene parámetros de cifrado fuera de rango".into())
        }
        EnvError::BadKey => AppError::AuthFailed("el PIN o la contraseña no son correctos".into()),
    }
}

pub(super) fn read_envelope(path: &Path) -> AppResult<Envelope> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(
                "la bóveda (vault.json): se borró mientras SSHorus estaba abierto".into(),
            ));
        }
        Err(e) => return Err(AppError::Io(format!("no se pudo leer {}: {e}", path.display()))),
    };
    serde_json::from_slice(&bytes).map_err(|_| env_error(EnvError::Damaged))
}

/// Cifra y escribe los secretos (atómico, 0600).
pub(super) fn write_file(path: &Path, open: &Open, secrets: &Secrets) -> AppResult<()> {
    let plain: BTreeMap<&str, &str> = secrets.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    // Se reserva de antemano para que el texto en claro no deje copias al crecer.
    let cap = 32 + secrets.iter().map(|(k, v)| k.len() + 2 * v.len() + 8).sum::<usize>();
    let mut json = Zeroizing::new(Vec::with_capacity(cap));
    serde_json::to_writer(&mut *json, &ContentsRef { secrets: plain })?;
    let env = cipher::seal_with_kind(
        FORMAT,
        VERSION,
        &open.key,
        open.params,
        &open.salt_b64,
        Some(open.kind.as_str()),
        &json,
    )?;
    fsutil::write_json_atomic(path, &env)
}

/// Descifra el archivo con una llave ya derivada.
pub(super) fn open_with_key(env: &Envelope, key: &[u8; 32]) -> AppResult<Secrets> {
    let plain = cipher::open(env, FORMAT, VERSION, key).map_err(env_error)?;
    let c: Contents = serde_json::from_slice(&plain).map_err(|_| env_error(EnvError::Damaged))?;
    Ok(c.secrets.into_iter().map(|(k, v)| (k, Zeroizing::new(v))).collect())
}

/// Lee el archivo, deriva la llave desde el PIN (o contraseña) y la llave del equipo, y descifra.
pub(super) fn open_with_pin(path: &Path, pin: &str, device: &dyn DeviceKeyStore) -> AppResult<Open> {
    let env = read_envelope(path)?;
    let kind = PinKind::from_envelope(&env);
    if pin.is_empty() || pin.len() > MAX_UNLOCK_LEN {
        return Err(wrong_secret(kind));
    }
    let (params, salt) = cipher::check(&env, FORMAT, VERSION).map_err(env_error)?;
    let dk = load_device_key(device)?;
    let key = cipher::derive_key_keyed(pin.as_bytes(), &salt, params, &dk)?;
    let secrets = open_with_key(&env, &key).map_err(|e| match e {
        AppError::AuthFailed(_) => wrong_secret(kind),
        other => other,
    })?;
    Ok(Open {
        key,
        params,
        kind,
        salt_b64: env.kdf.salt,
        secrets,
    })
}

pub(super) fn load_device_key(device: &dyn DeviceKeyStore) -> AppResult<Zeroizing<Vec<u8>>> {
    match device.load()? {
        Some(k) if k.len() == DEVICE_KEY_LEN => Ok(k),
        Some(_) => Err(AppError::Invalid(format!(
            "la llave de este equipo en el llavero está dañada: usa {FORGOT} para empezar de cero"
        ))),
        None => Err(missing_device_key()),
    }
}

/// Bóveda abierta nueva: sal nueva y llave derivada del PIN (o contraseña) y la del equipo.
pub(super) fn seal_new(pin: &str, kind: PinKind, params: KdfParams, dk: &[u8], secrets: Secrets) -> AppResult<Open> {
    let salt_b64 = cipher::new_salt_b64()?;
    let key = cipher::derive_key_keyed_b64(pin.as_bytes(), &salt_b64, params, dk)?;
    Ok(Open {
        key,
        params,
        salt_b64,
        kind,
        secrets,
    })
}

/// Escribe y comprueba que lo escrito se vuelve a abrir con la misma llave y da lo mismo.
pub(super) fn write_verified(path: &Path, open: &Open) -> AppResult<()> {
    write_file(path, open, &open.secrets)?;
    let back = open_with_key(&read_envelope(path)?, &open.key)?;
    if back != open.secrets {
        return Err(AppError::Io(
            "la bóveda escrita no coincide al volver a leerla".into(),
        ));
    }
    Ok(())
}
