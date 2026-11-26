//! Ejecuciones en curso con identificador, para poder cancelarlas desde la interfaz.

use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

/// Ejecuciones en curso con identificador, para poder cancelarlas (`exec_cancel`).
#[derive(Default)]
pub struct ExecRegistry {
    running: Mutex<HashMap<String, CancellationToken>>,
}

/// Registro de una ejecución: al soltarlo se quita de la lista.
pub struct ExecTicket<'a> {
    registry: &'a ExecRegistry,
    id: String,
    pub token: CancellationToken,
}

impl Drop for ExecTicket<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.registry.running.lock() {
            map.remove(&self.id);
        }
    }
}

impl ExecRegistry {
    /// Anota una ejecución nueva. Error si el identificador está vacío o ya está en uso.
    pub fn register(&self, id: &str) -> AppResult<ExecTicket<'_>> {
        let id = id.trim();
        if id.is_empty() {
            return Err(AppError::Invalid("Identificador de ejecución vacío".into()));
        }
        let mut map = self.running.lock().map_err(|_| AppError::Invalid("Registro de ejecuciones bloqueado".into()))?;
        if map.contains_key(id) {
            return Err(AppError::Invalid("Ya hay una ejecución con ese identificador".into()));
        }
        let token = CancellationToken::new();
        map.insert(id.to_string(), token.clone());
        Ok(ExecTicket { registry: self, id: id.to_string(), token })
    }

    /// Pide cancelar. Devuelve false si ya terminó o no existe.
    pub fn cancel(&self, id: &str) -> bool {
        let Ok(map) = self.running.lock() else { return false };
        match map.get(id.trim()) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }
}
