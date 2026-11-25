//! Versiones RPM como las compara `rpm` (epoch, `~`, `^`, «el9_4» < «el9_5») y si una versión instalada
//! está dentro de los rangos de un aviso de OSV.
//!
//! Por qué hace falta: a OSV se le pregunta SIN epoch (así no se pierde ningún aviso cuyo dato venga sin
//! él), pero Rocky y AlmaLinux escriben la versión arreglada CON epoch («1:3.2.2-6.el9_5»). Sin epoch,
//! OSV cree que «3.5.1-4.el9_7» es más vieja que «1:3.0.1-43.el9_0» y da el aviso como pendiente para
//! siempre, aunque ya esté actualizado. Por eso cada aviso se vuelve a comprobar aquí con la versión
//! completa instalada.

use std::cmp::Ordering;

use super::osv_model::Range;

/// `rpmvercmp`: trozos de números y de letras; lo demás separa. `~` va antes que todo (incluso el final)
/// y `^` después del final pero antes que cualquier otro trozo.
pub fn rpmvercmp(a: &str, b: &str) -> Ordering {
    if a == b {
        return Ordering::Equal;
    }
    let (mut x, mut y) = (a.as_bytes(), b.as_bytes());
    let keep = |c: u8| c.is_ascii_alphanumeric() || c == b'~' || c == b'^';
    loop {
        while x.first().is_some_and(|&c| !keep(c)) {
            x = &x[1..];
        }
        while y.first().is_some_and(|&c| !keep(c)) {
            y = &y[1..];
        }
        match (x.first(), y.first()) {
            (Some(b'~'), Some(b'~')) => {
                x = &x[1..];
                y = &y[1..];
                continue;
            }
            (Some(b'~'), _) => return Ordering::Less,
            (_, Some(b'~')) => return Ordering::Greater,
            (Some(b'^'), Some(b'^')) => {
                x = &x[1..];
                y = &y[1..];
                continue;
            }
            (Some(b'^'), None) => return Ordering::Greater,
            (None, Some(b'^')) => return Ordering::Less,
            (Some(b'^'), _) => return Ordering::Less,
            (_, Some(b'^')) => return Ordering::Greater,
            _ => {}
        }
        let (Some(&c), Some(_)) = (x.first(), y.first()) else { break };
        let numeric = c.is_ascii_digit();
        let seg = |s: &[u8]| s.iter().take_while(|c| if numeric { c.is_ascii_digit() } else { c.is_ascii_alphabetic() }).count();
        let (nx, ny) = (seg(x), seg(y));
        // Trozos de distinto tipo: el numérico es más nuevo.
        if ny == 0 {
            return if numeric { Ordering::Greater } else { Ordering::Less };
        }
        let (sx, sy) = (&x[..nx], &y[..ny]);
        let o = if numeric {
            let strip = |s: &[u8]| -> usize { s.iter().take_while(|&&c| c == b'0').count() };
            let (tx, ty) = (&sx[strip(sx)..], &sy[strip(sy)..]);
            tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty))
        } else {
            sx.cmp(sy)
        };
        if o != Ordering::Equal {
            return o;
        }
        x = &x[nx..];
        y = &y[ny..];
    }
    match (x.is_empty(), y.is_empty()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Less,
        _ => Ordering::Greater,
    }
}

/// «epoch:versión-release» por partes. `epoch` = None si no viene escrito.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evr<'a> {
    pub epoch: Option<u64>,
    pub version: &'a str,
    pub release: Option<&'a str>,
}

pub fn parse_evr(s: &str) -> Evr<'_> {
    let s = s.trim();
    let (epoch, rest) = match s.split_once(':') {
        Some((e, r)) if !e.is_empty() && e.chars().all(|c| c.is_ascii_digit()) => (e.parse().ok(), r),
        _ => (None, s),
    };
    match rest.rsplit_once('-') {
        Some((v, r)) => Evr { epoch, version: v, release: Some(r) },
        None => Evr { epoch, version: rest, release: None },
    }
}

/// Compara la versión instalada (sin epoch escrito = 0) con una de un aviso. Si el aviso no escribe el
/// epoch y la instalada tiene uno, se comparan sin él (el dato lo olvidó: el epoch casi nunca cambia).
pub fn cmp_installed(installed: &str, other: &str) -> Ordering {
    let (a, b) = (parse_evr(installed), parse_evr(other));
    let ea = a.epoch.unwrap_or(0);
    let epoch = match b.epoch {
        Some(eb) => ea.cmp(&eb),
        None => Ordering::Equal,
    };
    epoch.then_with(|| rpmvercmp(a.version, b.version)).then_with(|| match (a.release, b.release) {
        (Some(x), Some(y)) => rpmvercmp(x, y),
        _ => Ordering::Equal,
    })
}

/// ¿La versión instalada está afectada según los rangos `ECOSYSTEM` de un aviso? None = el aviso no
/// tiene rangos que se puedan comprobar (se cree a OSV).
pub fn affected_by(ranges: &[Range], installed: &str) -> Option<bool> {
    let mut any = false;
    for r in ranges.iter().filter(|r| r.kind == "ECOSYSTEM") {
        any = true;
        let mut events: Vec<(&str, &str)> = r
            .events
            .iter()
            .flat_map(|e| e.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.as_str(), v))))
            .filter(|(k, _)| matches!(*k, "introduced" | "fixed" | "last_affected"))
            .collect();
        let zero = |v: &str| v == "0";
        events.sort_by(|a, b| match (zero(a.1), zero(b.1)) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => cmp_installed(a.1, b.1),
        });
        let mut hit = false;
        for (kind, v) in events {
            let o = if zero(v) { Ordering::Greater } else { cmp_installed(installed, v) };
            match kind {
                "introduced" if o != Ordering::Less => hit = true,
                "fixed" if o != Ordering::Less => hit = false,
                "last_affected" if o == Ordering::Greater => hit = false,
                _ => {}
            }
        }
        if hit {
            return Some(true);
        }
    }
    any.then_some(false)
}

/// Epoch escrito en una versión de paquete («1:3.0.7-27.el9» → Some(1); sin él o 0 → None).
pub fn epoch_of(version: &str) -> Option<u64> {
    parse_evr(version).epoch.filter(|e| *e > 0)
}

/// Versión completa para comparar: `vr` («versión-release») con el epoch de `full` si lo tiene.
pub fn with_epoch(full: &str, vr: &str) -> String {
    match epoch_of(full) {
        Some(e) => format!("{e}:{vr}"),
        None => vr.to_string(),
    }
}
