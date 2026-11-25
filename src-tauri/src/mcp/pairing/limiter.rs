//! Límite de peticiones de emparejado (función pura sobre el reloj que se le pasa).
//!
//! Cualquier programa del equipo puede pedir emparejarse: sin límite, uno malicioso podría llenarte la
//! pantalla de avisos. Por eso: una sola petición esperando por asistente y, en total, como mucho
//! `MAX_PER_WINDOW` por minuto. Lo que pasa del límite se rechaza (429) sin mostrar nada.

use std::collections::{BTreeSet, VecDeque};

pub const WINDOW_MS: u64 = 60_000;
pub const MAX_PER_WINDOW: usize = 3;

/// Por qué no se acepta una petición.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Limited {
    /// Ya hay una petición de este asistente esperando tu respuesta.
    AlreadyWaiting,
    /// Demasiadas peticiones en el último minuto.
    TooMany,
}

#[derive(Debug)]
pub struct RateLimiter {
    /// Inicio (ms) de las peticiones del último minuto.
    recent: VecDeque<u64>,
    /// Asistentes con una petición esperando.
    waiting: BTreeSet<String>,
    max: usize,
}

impl Default for RateLimiter {
    fn default() -> Self {
        RateLimiter::with_max(MAX_PER_WINDOW)
    }
}

impl RateLimiter {
    /// Otro máximo por minuto (el registro dinámico de clientes OAuth, que no muestra nada).
    pub fn with_max(max: usize) -> Self {
        RateLimiter { recent: VecDeque::new(), waiting: BTreeSet::new(), max }
    }

    /// Deja pasar (y la cuenta) o dice por qué no. Si pasa, hay que llamar a `finish` al terminar.
    pub fn begin(&mut self, client_id: &str, now: u64) -> Result<(), Limited> {
        while self.recent.front().is_some_and(|t| now.saturating_sub(*t) >= WINDOW_MS) {
            self.recent.pop_front();
        }
        if self.waiting.contains(client_id) {
            return Err(Limited::AlreadyWaiting);
        }
        if self.recent.len() >= self.max {
            return Err(Limited::TooMany);
        }
        self.recent.push_back(now);
        self.waiting.insert(client_id.to_string());
        Ok(())
    }

    pub fn finish(&mut self, client_id: &str) {
        self.waiting.remove(client_id);
    }
}

impl Limited {
    pub fn message(self) -> &'static str {
        match self {
            Limited::AlreadyWaiting => "Ya hay una petición de este asistente esperando en SSHorus: respóndela allí.",
            Limited::TooMany => "Demasiadas peticiones de emparejado: espera un minuto y vuelve a intentarlo.",
        }
    }
}
