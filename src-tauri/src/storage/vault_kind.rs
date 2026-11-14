//! Con qué se protege la bóveda: PIN de 6 números o contraseña (8 caracteres o más).
//!
//! El tipo va en la cabecera autenticada del archivo (`kind` del sobre), sin secretos, para saber
//! qué pedir antes de desbloquear. Las bóvedas creadas antes de poder elegir no llevan etiqueta y
//! se tratan como "text": PIN escrito en un campo de texto normal, que acepta lo que fuera.

use serde::{Deserialize, Serialize};

use super::cipher::Envelope;
use crate::error::{AppError, AppResult};

/// Números del PIN.
pub const PIN_LEN: usize = 6;
/// Caracteres mínimos de una contraseña.
pub const PASSWORD_MIN_LEN: usize = 8;
/// Largo máximo (en bytes) de lo que se acepta al desbloquear; una contraseña nueva no puede pasarlo.
pub(super) const MAX_UNLOCK_LEN: usize = 256;

/// Tipo de protección de la bóveda.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PinKind {
    /// PIN de 6 números.
    #[default]
    #[serde(rename = "pin6")]
    Pin6,
    /// Contraseña de texto libre (8 caracteres o más).
    #[serde(rename = "password")]
    Password,
    /// Texto libre sin reglas: bóvedas creadas antes de poder elegir. No se puede elegir al crear.
    #[serde(rename = "text")]
    Text,
}

impl PinKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PinKind::Pin6 => "pin6",
            PinKind::Password => "password",
            PinKind::Text => "text",
        }
    }

    /// Cómo se llama en los mensajes («el PIN», «la contraseña»).
    pub fn noun(self) -> &'static str {
        match self {
            PinKind::Password => "la contraseña",
            PinKind::Pin6 | PinKind::Text => "el PIN",
        }
    }

    /// Lee la etiqueta del sobre. Sin etiqueta (bóveda antigua) o desconocida: texto libre.
    pub(super) fn from_envelope(env: &Envelope) -> Self {
        match env.kind.as_deref() {
            Some("pin6") => PinKind::Pin6,
            Some("password") => PinKind::Password,
            _ => PinKind::Text,
        }
    }
}

/// Error de PIN o contraseña incorrectos (cuenta como intento fallido).
pub(super) fn wrong_secret(kind: PinKind) -> AppError {
    match kind {
        PinKind::Password => AppError::AuthFailed("la contraseña no es correcta".into()),
        PinKind::Pin6 | PinKind::Text => AppError::AuthFailed("el PIN no es correcto".into()),
    }
}

/// Comprueba un PIN nuevo: exactamente 6 números (0-9).
pub fn check_new_pin(pin: &str) -> AppResult<()> {
    if pin.len() == PIN_LEN && pin.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("El PIN debe tener {PIN_LEN} números")))
    }
}

/// Comprueba una contraseña nueva: 8 caracteres o más, que no sean solo espacios, y que quepa en
/// lo que se acepta al desbloquear.
pub fn check_new_password(password: &str) -> AppResult<()> {
    if password.chars().count() < PASSWORD_MIN_LEN || password.trim().is_empty() {
        return Err(AppError::Invalid(format!(
            "La contraseña debe tener al menos {PASSWORD_MIN_LEN} caracteres"
        )));
    }
    if password.len() > MAX_UNLOCK_LEN {
        return Err(AppError::Invalid("La contraseña es demasiado larga".into()));
    }
    Ok(())
}

/// Comprueba el PIN o la contraseña nuevos según el tipo elegido. "text" no se puede elegir.
pub fn check_new_secret(secret: &str, kind: PinKind) -> AppResult<()> {
    match kind {
        PinKind::Pin6 => check_new_pin(secret),
        PinKind::Password => check_new_password(secret),
        PinKind::Text => Err(AppError::Invalid("Elige PIN o contraseña".into())),
    }
}
