//! Agrupado de la salida de la terminal antes de mandarla a la interfaz.
//!
//! El primer trozo tras un rato sin salida (la respuesta a un comando) y la salida escasa
//! (el eco de cada tecla, aunque se escriba rápido) salen en el acto. Solo cuando llega mucha salida
//! seguida (un `cat` largo, un programa que redibuja) se junta durante `FLUSH_DELAY` para no
//! saturar la interfaz con miles de mensajes.

use std::time::Duration;

use tokio::time::Instant;

/// Tiempo máximo que se retiene la salida cuando llega a ráfagas.
pub const FLUSH_DELAY: Duration = Duration::from_millis(6);
/// Tamaño a partir del cual se envía la salida sin esperar.
pub const FLUSH_BYTES: usize = 64 * 1024;
/// Mientras una ráfaga lleve enviado menos que esto, cada trozo sale en el acto (el eco de lo tecleado).
const BURST_BYTES: usize = 1024;

#[derive(Default)]
pub struct OutputBatch {
    buf: Vec<u8>,
    /// Cuándo hay que enviar lo retenido (None = nada retenido).
    deadline: Option<Instant>,
    last_flush: Option<Instant>,
    /// Bytes enviados desde el último rato sin salida.
    burst: usize,
}

impl OutputBatch {
    /// Lo que llegó antes de que la shell estuviera lista: se envía cuanto antes.
    pub fn with_early(early: Vec<u8>, now: Instant) -> Self {
        let deadline = (!early.is_empty()).then_some(now);
        Self { buf: early, deadline, last_flush: None, burst: 0 }
    }

    /// Añade salida; devuelve lo que hay que enviar ya (si toca).
    pub fn push(&mut self, data: &[u8], now: Instant) -> Option<Vec<u8>> {
        self.buf.extend_from_slice(data);
        if self.deadline.is_none() && self.last_flush.is_none_or(|t| now - t >= FLUSH_DELAY) {
            self.burst = 0;
        }
        if (self.deadline.is_none() && self.burst < BURST_BYTES) || self.buf.len() >= FLUSH_BYTES {
            return self.take(now);
        }
        if self.deadline.is_none() {
            self.deadline = Some(now + FLUSH_DELAY);
        }
        None
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    /// Vacía lo retenido (al vencer el plazo o al terminar).
    pub fn take(&mut self, now: Instant) -> Option<Vec<u8>> {
        self.deadline = None;
        if self.buf.is_empty() {
            return None;
        }
        self.last_flush = Some(now);
        self.burst += self.buf.len();
        Some(std::mem::take(&mut self.buf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_chunk_after_quiet_goes_out_now() {
        let t0 = Instant::now();
        let mut b = OutputBatch::default();
        assert_eq!(b.push(b"a", t0), Some(b"a".to_vec()));
        assert_eq!(b.deadline(), None);
        // Otra tecla un rato después: también al momento.
        let t1 = t0 + Duration::from_millis(50);
        assert_eq!(b.push(b"b", t1), Some(b"b".to_vec()));
    }

    #[test]
    fn fast_typing_echo_is_not_delayed() {
        let t0 = Instant::now();
        let mut b = OutputBatch::default();
        assert!(b.push(b"a", t0).is_some());
        let t1 = t0 + Duration::from_millis(1);
        assert_eq!(b.push(b"b", t1), Some(b"b".to_vec()));
    }

    #[test]
    fn burst_is_grouped_until_deadline() {
        let t0 = Instant::now();
        let mut b = OutputBatch::default();
        let chunk = vec![b'1'; 4096];
        assert!(b.push(&chunk, t0).is_some());
        let t1 = t0 + Duration::from_millis(1);
        assert_eq!(b.push(b"2", t1), None);
        assert_eq!(b.push(b"3", t1 + Duration::from_millis(1)), None);
        assert_eq!(b.deadline(), Some(t1 + FLUSH_DELAY));
        assert_eq!(b.take(t1 + FLUSH_DELAY), Some(b"23".to_vec()));
        assert_eq!(b.deadline(), None);
        // Sigue la ráfaga justo tras enviar: se vuelve a agrupar.
        assert_eq!(b.push(b"4", t1 + FLUSH_DELAY), None);
        // Tras un rato sin salida, lo siguiente vuelve a salir en el acto.
        let t2 = t1 + FLUSH_DELAY * 2;
        assert_eq!(b.take(t2), Some(b"4".to_vec()));
        assert_eq!(b.push(b"5", t2 + FLUSH_DELAY), Some(b"5".to_vec()));
    }

    #[test]
    fn many_small_chunks_in_a_row_get_grouped() {
        let t0 = Instant::now();
        let mut b = OutputBatch::default();
        let chunk = [b'x'; 300];
        let sent_now = (0..10)
            .filter(|i| b.push(&chunk, t0 + Duration::from_micros(100 * i)).is_some())
            .count();
        assert_eq!(sent_now, 4, "hasta pasar BURST_BYTES");
        assert!(b.deadline().is_some());
    }

    #[test]
    fn big_burst_is_sent_without_waiting() {
        let t0 = Instant::now();
        let mut b = OutputBatch::default();
        b.push(b"x", t0);
        let big = vec![0u8; FLUSH_BYTES];
        assert_eq!(b.push(&big, t0).map(|v| v.len()), Some(FLUSH_BYTES));
    }

    #[test]
    fn early_output_is_due_immediately() {
        let t0 = Instant::now();
        let mut b = OutputBatch::with_early(b"hola".to_vec(), t0);
        assert_eq!(b.deadline(), Some(t0));
        assert_eq!(b.take(t0), Some(b"hola".to_vec()));
        assert!(OutputBatch::with_early(Vec::new(), t0).deadline().is_none());
        assert_eq!(b.take(t0), None);
    }
}
