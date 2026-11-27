//! Agrupar ráfagas de cambios: un editor que guarda escribe varias veces seguidas (temporal,
//! renombrar, fecha). Se espera a que la carpeta lleve un rato quieta y se sube una sola vez.

use std::collections::{BTreeSet, HashSet};

use super::snapshot::Changes;

/// Tiempo sin cambios antes de subir.
pub const QUIET_MS: u64 = 500;

#[derive(Debug, Default)]
pub struct Debouncer {
    changed: BTreeSet<String>,
    removed: BTreeSet<String>,
    /// Momento (ms) del último cambio visto.
    last: u64,
}

impl Debouncer {
    pub fn push(&mut self, c: Changes, now_ms: u64) {
        if c.is_empty() {
            return;
        }
        for rel in c.changed {
            self.removed.remove(&rel);
            self.changed.insert(rel);
        }
        for rel in c.removed {
            self.changed.remove(&rel);
            self.removed.insert(rel);
        }
        self.last = now_ms;
    }

    pub fn has_pending(&self) -> bool {
        !self.changed.is_empty() || !self.removed.is_empty()
    }

    pub fn pending(&self) -> usize {
        self.changed.len() + self.removed.len()
    }

    /// Lo listo para subir si la carpeta lleva `QUIET_MS` quieta. Lo que aún se está subiendo
    /// (`busy`) se queda esperando: no se escriben dos copias a la vez sobre el mismo archivo.
    pub fn take_ready(&mut self, now_ms: u64, busy: &HashSet<String>) -> Option<Changes> {
        if !self.has_pending() || now_ms.saturating_sub(self.last) < QUIET_MS {
            return None;
        }
        let changed: Vec<String> = self.changed.iter().filter(|r| !busy.contains(*r)).cloned().collect();
        let removed: Vec<String> = self.removed.iter().filter(|r| !busy.contains(*r)).cloned().collect();
        for r in changed.iter().chain(&removed) {
            self.changed.remove(r);
            self.removed.remove(r);
        }
        let out = Changes { changed, removed };
        (!out.is_empty()).then_some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ch(changed: &[&str], removed: &[&str]) -> Changes {
        Changes {
            changed: changed.iter().map(|s| s.to_string()).collect(),
            removed: removed.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn waits_for_quiet_then_flushes_once() {
        let mut d = Debouncer::default();
        let none = HashSet::new();
        d.push(ch(&["a"], &[]), 1000);
        assert!(d.take_ready(1200, &none).is_none());
        d.push(ch(&["a", "b"], &[]), 1300);
        assert!(d.take_ready(1700, &none).is_none());
        let out = d.take_ready(1800, &none).unwrap();
        assert_eq!(out.changed, vec!["a", "b"]);
        assert!(!d.has_pending());
        assert!(d.take_ready(5000, &none).is_none());
    }

    #[test]
    fn delete_then_recreate_is_a_change() {
        let mut d = Debouncer::default();
        d.push(ch(&[], &["a"]), 0);
        d.push(ch(&["a"], &[]), 100);
        let out = d.take_ready(1000, &HashSet::new()).unwrap();
        assert_eq!(out, ch(&["a"], &[]));

        d.push(ch(&["b"], &[]), 2000);
        d.push(ch(&[], &["b"]), 2100);
        assert_eq!(d.take_ready(3000, &HashSet::new()).unwrap(), ch(&[], &["b"]));
    }

    #[test]
    fn busy_files_wait_for_their_upload() {
        let mut d = Debouncer::default();
        d.push(ch(&["a", "b"], &[]), 0);
        let busy: HashSet<String> = ["a".to_string()].into();
        assert_eq!(d.take_ready(1000, &busy).unwrap(), ch(&["b"], &[]));
        assert_eq!(d.pending(), 1);
        assert!(d.take_ready(1100, &busy).is_none());
        assert_eq!(d.take_ready(1200, &HashSet::new()).unwrap(), ch(&["a"], &[]));
    }

    #[test]
    fn empty_push_does_not_reset_timer() {
        let mut d = Debouncer::default();
        d.push(ch(&["a"], &[]), 0);
        d.push(Changes::default(), 400);
        assert!(d.take_ready(600, &HashSet::new()).is_some());
    }
}
