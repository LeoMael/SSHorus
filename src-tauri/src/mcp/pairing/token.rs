//! Tokens de los asistentes emparejados (funciones puras).
//!
//! Forma: `tvc_<kid>_<64 hex>`. `kid` (8 hex) dice de qué asistente es sin revelar nada: así se busca
//! su ficha y se compara una sola huella, y un token revocado se reconoce en el registro. SSHorus no
//! guarda el token: solo su huella Argon2id con sal propia. El token tiene 256 bits al azar, así que no
//! hace falta un cálculo lento: basta un Argon2 barato (ya está en la app para la bóveda).

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::storage::cipher::{derive_key, KdfParams};

pub const PREFIX: &str = "tvc_";
/// Coste bajo a propósito (ver arriba): se calcula en cada petición del asistente.
const PARAMS: KdfParams = KdfParams { m_kib: 64, t: 1, p: 1 };

/// Huella guardada de un token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenHash {
    /// Sal (hex, 16 bytes).
    pub salt: String,
    /// Argon2id(token, sal) (hex, 32 bytes).
    pub hash: String,
}

/// Token recién creado: se entrega una sola vez al puente y se olvida.
pub struct Issued {
    pub token: Zeroizing<String>,
    pub hash: TokenHash,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

/// `n` bytes al azar en hex.
pub fn random_hex(n: usize) -> AppResult<Zeroizing<String>> {
    let mut b = Zeroizing::new(vec![0u8; n]);
    getrandom::fill(&mut b[..]).map_err(|e| AppError::Invalid(format!("no se pudo generar un número al azar: {e}")))?;
    Ok(Zeroizing::new(hex(&b)))
}

/// Id corto y público de un asistente dentro de su token.
pub fn new_kid() -> AppResult<String> {
    Ok(random_hex(4)?.to_string())
}

/// `kid` de un token con la forma de los emparejados (None si no la tiene).
pub fn kid_of(token: &str) -> Option<&str> {
    let rest = token.strip_prefix(PREFIX)?;
    let (kid, secret) = rest.split_once('_')?;
    (kid.len() == 8 && secret.len() == 64).then_some(kid)
}

pub fn issue(kid: &str) -> AppResult<Issued> {
    let secret = random_hex(32)?;
    let token = Zeroizing::new(format!("{PREFIX}{kid}_{}", secret.as_str()));
    let salt = random_hex(16)?;
    let hash = digest(&token, &salt)?;
    Ok(Issued { token, hash: TokenHash { salt: salt.to_string(), hash } })
}

fn digest(token: &str, salt_hex: &str) -> AppResult<String> {
    let salt = unhex(salt_hex).ok_or_else(|| AppError::Invalid("huella de token dañada".into()))?;
    Ok(hex(derive_key(token.as_bytes(), &salt, PARAMS)?.as_ref()))
}

/// El token es el de esta huella (comparación en tiempo constante).
pub fn verify(token: &str, h: &TokenHash) -> bool {
    digest(token, &h.salt).is_ok_and(|d| constant_time_eq(d.as_bytes(), h.hash.as_bytes()))
}

/// Compara sin cortar en la primera diferencia (no da pistas por el tiempo).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= usize::from(x ^ y);
    }
    diff == 0
}
