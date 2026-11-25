//! Modelo de aviso OSV (`OsvVuln`), extracción de CVE/gravedad/versión arreglada y comparación natural.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value;

use super::osv::Hit;
use super::parse::{is_cve, rpm::strip_epoch};

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SevEntry {
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub score: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AffPkg {
    #[serde(default)]
    pub ecosystem: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Range {
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub events: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Affected {
    #[serde(default)]
    pub package: Option<AffPkg>,
    #[serde(default)]
    pub ranges: Vec<Range>,
    #[serde(default)]
    pub ecosystem_specific: Option<Value>,
    #[serde(default)]
    pub database_specific: Option<Value>,
    #[serde(default)]
    pub severity: Vec<SevEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Reference {
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OsvVuln {
    pub id: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub details: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub upstream: Vec<String>,
    #[serde(default)]
    pub related: Vec<String>,
    #[serde(default)]
    pub modified: Option<String>,
    #[serde(default)]
    pub published: Option<String>,
    #[serde(default)]
    pub severity: Vec<SevEntry>,
    #[serde(default)]
    pub affected: Vec<Affected>,
    #[serde(default)]
    pub database_specific: Option<Value>,
    #[serde(default)]
    pub references: Vec<Reference>,
}

/// Compara versiones «a lo natural»: números como números, texto como texto, «~» antes que nada
/// (Debian). Sirve para elegir la versión que arregla de entre varias ramas; OSV ya decidió si afecta.
pub fn cmp_versions(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let a = strip_epoch(a);
    let b = strip_epoch(b);
    let (mut x, mut y) = (a.as_bytes(), b.as_bytes());
    loop {
        match (x.first(), y.first()) {
            (None, None) => return Ordering::Equal,
            (Some(b'~'), _) if y.first() != Some(&b'~') => return Ordering::Less,
            (_, Some(b'~')) if x.first() != Some(&b'~') => return Ordering::Greater,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let nx = x.iter().take_while(|c| c.is_ascii_digit()).count();
                let ny = y.iter().take_while(|c| c.is_ascii_digit()).count();
                let sx = std::str::from_utf8(&x[..nx]).unwrap_or("0").trim_start_matches('0');
                let sy = std::str::from_utf8(&y[..ny]).unwrap_or("0").trim_start_matches('0');
                let o = sx.len().cmp(&sy.len()).then_with(|| sx.cmp(sy));
                if o != Ordering::Equal {
                    return o;
                }
                x = &x[nx..];
                y = &y[ny..];
            }
            (Some(c), Some(d)) => {
                if c != d {
                    return match (c.is_ascii_digit(), d.is_ascii_digit()) {
                        (true, false) => Ordering::Greater,
                        (false, true) => Ordering::Less,
                        _ => c.cmp(d),
                    };
                }
                x = &x[1..];
                y = &y[1..];
            }
        }
    }
}

impl OsvVuln {
    /// CVE de este aviso: él mismo si es CVE, más los de `upstream`, `aliases` y `related`.
    pub fn cves(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut add = |s: &str| {
            if is_cve(s) && !out.iter().any(|x| x == s) {
                out.push(s.to_string());
            }
        };
        add(&self.id);
        for s in self.upstream.iter().chain(&self.aliases).chain(&self.related) {
            add(s);
        }
        out
    }

    /// Otros ids que no son CVE (DEBIAN-CVE-…, BIT-…, GHSA-…, USN-…).
    pub fn other_ids(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for s in std::iter::once(&self.id).chain(&self.upstream).chain(&self.aliases) {
            if !is_cve(s) && !out.contains(s) {
                out.push(s.clone());
            }
        }
        out
    }

    pub fn affected_for(&self, eco: &str, name: &str) -> Option<&Affected> {
        self.affected
            .iter()
            .find(|a| a.package.as_ref().is_some_and(|p| p.ecosystem == eco && p.name == name))
            .or_else(|| self.affected.iter().find(|a| a.package.as_ref().is_some_and(|p| p.ecosystem == eco)))
    }

    /// RPM: ¿la versión completa instalada (`installed`, con epoch) está afectada según sus rangos?
    /// None = no hay rangos del paquete que comprobar (se cree a OSV). Ver `rpmver.rs`.
    pub fn rpm_affects(&self, eco: &str, name: &str, installed: &str) -> Option<bool> {
        let mut verdict = None;
        for a in self.affected.iter().filter(|a| a.package.as_ref().is_some_and(|p| p.ecosystem == eco && p.name == name)) {
            match super::rpmver::affected_by(&a.ranges, installed) {
                Some(true) => return Some(true),
                Some(false) => verdict = Some(false),
                None => {}
            }
        }
        verdict
    }

    /// Versión que lo arregla (de entre los `fixed` del ecosistema, la menor por encima de la instalada).
    pub fn fixed_for(&self, eco: &str, name: &str, installed: &str) -> Option<String> {
        let a = self.affected_for(eco, name)?;
        let mut fixes: Vec<String> = a
            .ranges
            .iter()
            .filter(|r| r.kind != "GIT")
            .flat_map(|r| r.events.iter())
            .filter_map(|e| e.get("fixed").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        fixes.sort_by(|x, y| cmp_versions(x, y));
        fixes.dedup();
        let pick = fixes
            .iter()
            .find(|f| cmp_versions(f, installed) == std::cmp::Ordering::Greater)
            .or_else(|| fixes.last())?;
        let pick = if pick.starts_with("0:") { pick.trim_start_matches("0:") } else { pick };
        Some(pick.to_string())
    }

    /// Gravedad según la distro o la base (texto original).
    pub fn distro_severity(&self, eco: &str, name: &str) -> Option<String> {
        let a = self.affected_for(eco, name);
        let get_str = |v: Option<&Value>, k: &str| v.and_then(|v| v.get(k)).and_then(|s| s.as_str()).map(str::to_string);
        if let Some(u) = get_str(a.and_then(|a| a.ecosystem_specific.as_ref()), "urgency") {
            return Some(u);
        }
        if let Some(s) = self.severity.iter().chain(a.map(|a| a.severity.iter()).into_iter().flatten()).find(|s| s.kind == "Ubuntu") {
            return Some(s.score.clone());
        }
        if let Some(s) = self.summary.as_deref().and_then(super::severity::from_summary_prefix) {
            return Some(s);
        }
        get_str(self.database_specific.as_ref(), "severity")
            .or_else(|| get_str(a.and_then(|a| a.ecosystem_specific.as_ref()), "severity"))
            .or_else(|| get_str(a.and_then(|a| a.database_specific.as_ref()), "severity"))
    }

    /// Mayor puntuación CVSS (v3 primero; v4 o v2 si no hay v3) y su vector.
    pub fn cvss(&self, eco: &str, name: &str) -> Option<(f64, String)> {
        let a = self.affected_for(eco, name);
        let all: Vec<&SevEntry> = self.severity.iter().chain(a.map(|a| a.severity.iter()).into_iter().flatten()).collect();
        for kind in ["CVSS_V3", "CVSS_V4", "CVSS_V2"] {
            let best = all
                .iter()
                .filter(|s| s.kind == kind)
                .filter_map(|s| super::severity::cvss_score(&s.score).map(|n| (n, s.score.clone())))
                .max_by(|x, y| x.0.total_cmp(&y.0));
            if best.is_some() {
                return best;
            }
        }
        None
    }

    /// Título corto: `summary` o el principio de `details`.
    pub fn title(&self) -> Option<String> {
        let s = self.summary.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let s = s.map(str::to_string).or_else(|| {
            let d = self.details.as_deref()?.trim();
            let first = d.split("\n\n").next().unwrap_or(d);
            Some(first.to_string()).filter(|x| !x.is_empty())
        })?;
        Some(super::parse::short(&s, 200))
    }

    pub fn reference_urls(&self) -> Vec<String> {
        self.references.iter().filter(|r| r.url.starts_with("https://") || r.url.starts_with("http://")).map(|r| r.url.clone()).take(20).collect()
    }
}

/// Ids únicos con su `modified`, en orden estable.
pub fn unique_ids(hits: &[Vec<Hit>]) -> Vec<(String, String)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for h in hits.iter().flatten() {
        if seen.insert(h.id.clone()) {
            out.push((h.id.clone(), h.modified.clone()));
        }
    }
    out
}
