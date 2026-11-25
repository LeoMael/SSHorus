//! PKCE (RFC 7636), solo S256: el cliente manda `BASE64URL(SHA-256(verificador))` al pedir la autorización y
//! el verificador al canjear el código. Quien robe el código sin el verificador no puede usarlo.

use base64ct::{Base64UrlUnpadded, Encoding};
use russh::keys::HashAlg;

use super::super::pairing::token::constant_time_eq;

pub const METHOD: &str = "S256";

fn unreserved(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
}

/// Verificador válido: 43 a 128 caracteres «no reservados».
pub fn valid_verifier(v: &str) -> bool {
    (43..=128).contains(&v.len()) && unreserved(v)
}

/// Desafío S256 válido: 43 caracteres base64url (32 bytes).
pub fn valid_challenge(c: &str) -> bool {
    c.len() == 43 && Base64UrlUnpadded::decode_vec(c).is_ok_and(|b| b.len() == 32)
}

pub fn challenge_of(verifier: &str) -> String {
    Base64UrlUnpadded::encode_string(&HashAlg::Sha256.digest(verifier.as_bytes()))
}

/// El verificador corresponde al desafío (comparación en tiempo constante).
pub fn verify_s256(verifier: &str, challenge: &str) -> bool {
    valid_verifier(verifier) && constant_time_eq(challenge_of(verifier).as_bytes(), challenge.as_bytes())
}
