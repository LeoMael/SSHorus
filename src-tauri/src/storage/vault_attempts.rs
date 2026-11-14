//! Fallos seguidos al abrir la bóveda (PIN o contraseña) y la espera que imponen.
//!
//! 5 fallos libres; luego hay que esperar 30 s, el doble con cada fallo, hasta 15 min. El contador y
//! la hora del próximo intento se guardan en `vault-attempts.json` (reiniciar la app no los borra).
//! Nunca se borra nada por fallar.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::fsutil;
use crate::error::{AppError, AppResult};

/// Archivo del contador (en la misma carpeta que la bóveda).
pub const ATTEMPTS_FILE: &str = "vault-attempts.json";

/// Fallos permitidos sin esperar.
const FREE_FAILS: u32 = 5;
const FIRST_DELAY_SECS: u64 = 30;
const MAX_DELAY_SECS: u64 = 15 * 60;

/// Espera tras `fails` fallos seguidos: 5 libres; luego 30 s, 1 min, 2 min… hasta 15 min.
pub fn delay_after(fails: u32) -> Duration {
    if fails <= FREE_FAILS {
        return Duration::ZERO;
    }
    let exp = (fails - FREE_FAILS - 1).min(10);
    Duration::from_secs((FIRST_DELAY_SECS << exp).min(MAX_DELAY_SECS))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Fallos seguidos (se guarda en disco).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Attempts {
    fails: u32,
    /// Hora (unix, s) a partir de la cual se puede volver a probar.
    not_before: u64,
}

/// Contador de fallos con su archivo.
pub(super) struct Throttle {
    path: Option<PathBuf>,
    attempts: Mutex<Attempts>,
}

impl Throttle {
    /// Lee el contador de ese archivo (si no existe o no se puede leer, empieza de cero).
    pub(super) fn load(path: Option<PathBuf>) -> Self {
        let attempts = path
            .as_deref()
            .filter(|p| p.exists())
            .map(fsutil::read_json_or_default::<Attempts>)
            .unwrap_or_default();
        Throttle {
            path,
            attempts: Mutex::new(attempts),
        }
    }

    fn get(&self) -> std::sync::MutexGuard<'_, Attempts> {
        self.attempts.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Cuánto falta para poder volver a probar (None = ya).
    pub(super) fn retry_after(&self) -> Option<Duration> {
        let left = self.get().not_before.saturating_sub(unix_now());
        // Si el reloj fue hacia atrás, nunca más de la espera máxima.
        (left > 0).then(|| Duration::from_secs(left.min(MAX_DELAY_SECS)))
    }

    /// Error si todavía hay que esperar.
    pub(super) fn check(&self) -> AppResult<()> {
        let Some(d) = self.retry_after() else { return Ok(()) };
        let s = d.as_secs();
        let wait = if s >= 60 {
            format!("{} min {} s", s / 60, s % 60)
        } else {
            format!("{s} s")
        };
        Err(AppError::Invalid(format!(
            "Demasiados intentos fallidos: espera {wait} antes de volver a probar"
        )))
    }

    /// Registra el resultado de probar un PIN o contraseña (solo cuentan éxito y `AuthFailed`).
    pub(super) fn note<T>(&self, r: &AppResult<T>) {
        let mut a = self.get();
        match r {
            Ok(_) => *a = Attempts::default(),
            Err(AppError::AuthFailed(_)) => {
                a.fails = a.fails.saturating_add(1);
                let d = delay_after(a.fails);
                a.not_before = if d.is_zero() { 0 } else { unix_now() + d.as_secs() };
                log::warn!("bóveda: PIN o contraseña incorrectos ({} fallos seguidos)", a.fails);
            }
            Err(_) => return,
        }
        self.save(*a);
    }

    /// Vuelve a cero (al borrar la bóveda).
    pub(super) fn reset(&self) {
        *self.get() = Attempts::default();
        self.save(Attempts::default());
    }

    /// Guarda el contador en disco (si falla, se registra y sigue valiendo en memoria).
    fn save(&self, a: Attempts) {
        let Some(p) = &self.path else { return };
        let r = if a == Attempts::default() {
            match fs::remove_file(p) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::from(e)),
                _ => Ok(()),
            }
        } else {
            fsutil::write_json_atomic(p, &a)
        };
        if let Err(e) = r {
            log::warn!("bóveda: no se pudo guardar el contador de intentos: {e}");
        }
    }
}
