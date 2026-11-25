//! La puerta de la app: si SSHorus está bloqueado, el token general (con caché) y los asistentes emparejados
//! (por el puente y por OAuth).

use std::sync::{Arc, Mutex};

use zeroize::Zeroizing;

use super::http;
use super::oauth::OAuth;
use super::pairing::Pairing;
use crate::storage::secrets;
use crate::storage::vault::Vault;

pub struct AppGate {
    cache: Mutex<Option<Zeroizing<String>>>,
    pairing: Arc<Pairing>,
    oauth: Arc<OAuth>,
}

impl AppGate {
    pub fn new(pairing: Arc<Pairing>, oauth: Arc<OAuth>) -> Self {
        AppGate { cache: Mutex::new(None), pairing, oauth }
    }

    pub fn forget(&self) {
        *self.cache.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    pub(super) fn set(&self, token: Zeroizing<String>) {
        *self.cache.lock().unwrap_or_else(|p| p.into_inner()) = Some(token);
    }
}

impl http::Gate for AppGate {
    fn locked(&self) -> bool {
        let locked = Vault::global().status().locked;
        if locked {
            self.forget();
        }
        locked
    }

    fn token(&self) -> Option<Zeroizing<String>> {
        if let Some(t) = self.cache.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            return Some(t);
        }
        match secrets::get_secret(super::TOKEN_ID) {
            Ok(Some(t)) if !t.is_empty() => {
                let t = Zeroizing::new(t);
                self.set(t.clone());
                Some(t)
            }
            Ok(_) => None,
            Err(e) => {
                log::warn!("MCP: no se pudo leer el token: {e}");
                None
            }
        }
    }

    fn pairing(&self) -> Option<&Pairing> {
        Some(&self.pairing)
    }

    fn oauth(&self) -> Option<&OAuth> {
        Some(&self.oauth)
    }
}
