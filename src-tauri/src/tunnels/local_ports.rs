//! Puertos libres en tu PC para proponer al traer un servicio del servidor con un túnel local.

use std::net::{Ipv4Addr, TcpListener};

/// Cuántos puertos seguidos se prueban a partir del deseado antes de dejar que elija el sistema (0).
const TRIES: u16 = 100;

/// ¿Se puede escuchar en 127.0.0.1:`port`? (Es donde escuchan los túneles locales por defecto.)
pub fn is_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// Para cada puerto deseado, el mismo si está libre o el siguiente libre; 0 si no hay ninguno cerca
/// (el túnel escuchará donde diga el sistema). No repite puertos ni usa los de `avoid` (los de otros
/// túneles guardados, aunque estén parados).
pub fn suggest(wanted: &[u16], avoid: &[u16], free: impl Fn(u16) -> bool) -> Vec<u16> {
    let mut taken: Vec<u16> = avoid.to_vec();
    wanted
        .iter()
        .map(|&w| {
            let start = w.max(1);
            let pick = (0..TRIES)
                .filter_map(|i| start.checked_add(i))
                .find(|p| !taken.contains(p) && free(*p))
                .unwrap_or(0);
            if pick != 0 {
                taken.push(pick);
            }
            pick
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_port_when_free() {
        assert_eq!(suggest(&[5432, 3306], &[], |_| true), vec![5432, 3306]);
    }

    #[test]
    fn next_free_when_busy_or_avoided() {
        let busy = [5432, 5433];
        assert_eq!(suggest(&[5432], &[], |p| !busy.contains(&p)), vec![5434]);
        assert_eq!(suggest(&[6379], &[6379], |_| true), vec![6380]);
    }

    #[test]
    fn no_repeats_in_one_batch() {
        assert_eq!(suggest(&[8080, 8080], &[], |_| true), vec![8080, 8081]);
    }

    #[test]
    fn zero_when_nothing_near() {
        assert_eq!(suggest(&[9000], &[], |_| false), vec![0]);
        assert_eq!(suggest(&[65535], &[], |p| p != 65535), vec![0]);
    }

    #[test]
    fn real_bind_detects_busy_port() {
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("puerto de prueba");
        let port = l.local_addr().expect("dirección").port();
        assert!(!is_free(port));
        drop(l);
        assert!(is_free(port));
    }
}
