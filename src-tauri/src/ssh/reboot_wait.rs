//! Reinicio del servidor pedido por el usuario («Reiniciar ahora»): las sesiones de ese servidor se
//! cortan a propósito y su reconexión tiene que esperar más que en una caída normal (el arranque tarda
//! 30–120 s y la reconexión normal se rinde tras pocos intentos).
//!
//! La interfaz avisa con `ssh_expect_reboot` justo antes de lanzar el reinicio. Queda apuntado para
//! todas las sesiones abiertas con el mismo servidor (host y puerto): pestañas, el Panel de VPS…
//! Cuando el vigilante ve la caída (`take`), reintenta hasta el plazo con esperas espaciadas
//! (`Budget::reboot`), aunque la reconexión automática esté desactivada. Mientras arranca, el servidor
//! puede rechazar la entrada un momento (pam_nologin: «System is booting up»): unas pocas
//! autenticaciones fallidas no cortan la espera.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::ssh::SessionStore;

/// Lo más que se puede pedir esperar (s).
pub const MAX_WAIT_SECS: u32 = 900;
/// Si la conexión no se cae en este tiempo desde el aviso, el aviso caduca (el reinicio no llegó).
const ARMED_FOR: Duration = Duration::from_secs(600);
/// Autenticaciones fallidas que se toleran mientras arranca.
const AUTH_FAILURES_TOLERATED: u8 = 3;

struct Expected {
    armed_at: Instant,
    wait: Duration,
}

static EXPECTED: LazyLock<Mutex<HashMap<String, Expected>>> = LazyLock::new(Default::default);

fn with<T>(f: impl FnOnce(&mut HashMap<String, Expected>) -> T) -> T {
    let mut m = EXPECTED.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut m)
}

/// Apunta que el servidor de esa sesión se va a reiniciar: al caerse, esperar hasta `wait` a que vuelva.
pub fn expect(session_id: &str, wait: Duration) {
    with(|m| {
        m.insert(
            session_id.to_string(),
            Expected {
                armed_at: Instant::now(),
                wait,
            },
        )
    });
}

/// Olvida el aviso (reinicio cancelado o sesión cerrada).
pub fn forget(session_id: &str) {
    with(|m| m.remove(session_id));
}

/// La conexión se cayó: plazo hasta el que esperar si había un aviso vigente. Lo consume.
pub fn take(session_id: &str) -> Option<Instant> {
    let e = with(|m| m.remove(session_id))?;
    (e.armed_at.elapsed() <= ARMED_FOR).then(|| Instant::now() + e.wait)
}

/// Elemento `attempt` (1-based) de una lista de esperas; el último se repite.
pub(crate) fn pick(list: &[Duration], attempt: u8) -> Duration {
    let i = usize::from(attempt.max(1) - 1);
    list.get(i)
        .or_else(|| list.last())
        .copied()
        .unwrap_or(Duration::from_secs(1))
}

/// Cuántos intentos se pueden hacer como mucho y cuánto esperar antes de cada uno.
pub(crate) struct Budget {
    max: u8,
    backoff: Vec<Duration>,
    deadline: Option<Instant>,
    auth_failures: u8,
}

impl Budget {
    /// Caída normal: `attempts` intentos.
    pub fn normal(attempts: u8, backoff: &[Duration]) -> Self {
        Self {
            max: attempts.clamp(1, 20),
            backoff: backoff.to_vec(),
            deadline: None,
            auth_failures: 0,
        }
    }

    /// Reinicio esperado: hasta `deadline`. `max` es lo que cabe sumando solo las esperas.
    pub fn reboot(deadline: Instant, backoff: &[Duration]) -> Self {
        let window = deadline.saturating_duration_since(Instant::now());
        let mut used = Duration::ZERO;
        let mut max: u8 = 0;
        while max < u8::MAX {
            let next = used + pick(backoff, max + 1);
            if next > window && max > 0 {
                break;
            }
            used = next;
            max += 1;
        }
        Self {
            max,
            backoff: backoff.to_vec(),
            deadline: Some(deadline),
            auth_failures: 0,
        }
    }

    pub fn max(&self) -> u8 {
        self.max
    }

    pub fn is_reboot(&self) -> bool {
        self.deadline.is_some()
    }

    pub fn wait(&self, attempt: u8) -> Duration {
        pick(&self.backoff, attempt)
    }

    /// Ya pasó el plazo del reinicio (en una caída normal, nunca).
    pub fn expired(&self) -> bool {
        self.deadline.is_some_and(|d| Instant::now() >= d)
    }

    /// Un error que normalmente corta los reintentos, ¿se puede pasar por alto esta vez? Solo la
    /// autenticación fallida durante un reinicio, y pocas veces.
    pub fn tolerate(&mut self, e: &AppError) -> bool {
        if !self.is_reboot() || !matches!(e, AppError::AuthFailed(_)) {
            return false;
        }
        self.auth_failures += 1;
        self.auth_failures <= AUTH_FAILURES_TOLERATED
    }
}

/// Avisa que el servidor de esa sesión se va a reiniciar: todas las sesiones abiertas con el mismo
/// servidor (host y puerto) esperarán hasta `wait_secs` a que vuelva. `wait_secs` 0 = olvidar.
/// Devuelve cuántas sesiones quedaron avisadas.
pub async fn expect_for_session(sessions: &SessionStore, session_id: &str, wait_secs: u32) -> AppResult<u32> {
    let all = sessions.list().await;
    let target = match all.iter().find(|s| s.id == session_id) {
        Some(s) => (s.host.to_ascii_lowercase(), s.port),
        None if wait_secs == 0 => {
            forget(session_id);
            return Ok(0);
        }
        None => return Err(AppError::SessionNotFound(session_id.to_string())),
    };
    let wait = Duration::from_secs(u64::from(wait_secs.min(MAX_WAIT_SECS)));
    let mut n = 0;
    for s in all
        .iter()
        .filter(|s| (s.host.to_ascii_lowercase(), s.port) == target)
    {
        if wait.is_zero() {
            forget(&s.id);
        } else {
            expect(&s.id, wait);
        }
        n += 1;
    }
    Ok(n)
}

/// La interfaz va a reiniciar el servidor de esa sesión: todas las sesiones abiertas con el mismo
/// servidor (host y puerto) esperarán hasta `wait_secs` a que vuelva. `wait_secs` 0 = ya no
/// (reinicio cancelado). Devuelve cuántas sesiones quedaron avisadas.
#[tauri::command]
pub async fn ssh_expect_reboot(
    sessions: State<'_, SessionStore>,
    session_id: String,
    wait_secs: u32,
) -> AppResult<u32> {
    expect_for_session(&sessions, &session_id, wait_secs).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(v: &[u64]) -> Vec<Duration> {
        v.iter().map(|s| Duration::from_secs(*s)).collect()
    }

    #[test]
    fn take_consumes_and_respects_expiry() {
        expect("rw-a", Duration::from_secs(300));
        let d = take("rw-a").expect("plazo");
        let left = d.saturating_duration_since(Instant::now());
        assert!(left > Duration::from_secs(295) && left <= Duration::from_secs(300));
        assert!(take("rw-a").is_none(), "se consume");

        with(|m| {
            m.insert(
                "rw-b".into(),
                Expected {
                    armed_at: Instant::now() - ARMED_FOR - Duration::from_secs(1),
                    wait: Duration::from_secs(300),
                },
            )
        });
        assert!(take("rw-b").is_none(), "aviso caducado");

        expect("rw-c", Duration::from_secs(10));
        forget("rw-c");
        assert!(take("rw-c").is_none());
    }

    #[test]
    fn reboot_budget_fits_the_window() {
        let b = Budget::reboot(
            Instant::now() + Duration::from_secs(300),
            &secs(&[5, 5, 10, 15]),
        );
        // 5 + 5 + 10 = 20; luego de 15 en 15: 280 / 15 = 18 → 21 intentos.
        assert_eq!(b.max(), 21);
        assert!(b.is_reboot() && !b.expired());
        assert_eq!(b.wait(1), Duration::from_secs(5));
        assert_eq!(b.wait(30), Duration::from_secs(15));
        // Aunque el plazo sea mínimo, al menos un intento.
        assert_eq!(Budget::reboot(Instant::now(), &secs(&[5])).max(), 1);
        assert!(Budget::reboot(Instant::now(), &secs(&[5])).expired());
    }

    #[test]
    fn normal_budget_is_clamped_and_never_expires() {
        let b = Budget::normal(0, &secs(&[1, 2]));
        assert_eq!(b.max(), 1);
        assert!(!b.is_reboot() && !b.expired());
        assert_eq!(Budget::normal(99, &secs(&[1])).max(), 20);
    }

    #[test]
    fn only_a_few_auth_failures_are_tolerated_while_booting() {
        let auth = AppError::AuthFailed("no".into());
        let mut normal = Budget::normal(5, &secs(&[1]));
        assert!(!normal.tolerate(&auth));
        let mut b = Budget::reboot(Instant::now() + Duration::from_secs(60), &secs(&[5]));
        assert!(!b.tolerate(&AppError::NeedsPassword));
        assert!(b.tolerate(&auth) && b.tolerate(&auth) && b.tolerate(&auth));
        assert!(!b.tolerate(&auth), "la cuarta ya corta");
    }

    #[test]
    fn pick_repeats_the_last() {
        let l = secs(&[1, 2, 5]);
        let got: Vec<u64> = (1..=5).map(|a| pick(&l, a).as_secs()).collect();
        assert_eq!(got, [1, 2, 5, 5, 5]);
        assert_eq!(pick(&[], 3), Duration::from_secs(1));
    }
}
