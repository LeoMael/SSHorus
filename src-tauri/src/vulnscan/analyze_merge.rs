//! Consultas a OSV de cada paquete y fusión de hallazgos por clave (`Merger`). Los hallazgos de cada
//! fuente están en `analyze_sources.rs`; las piezas del informe, en `analyze_report.rs`.

use std::collections::{BTreeMap, BTreeSet};

use super::ecosystem;
use super::model::*;
use super::osv::Query;
use super::rpmver;
use super::severity;

/// Para qué sirve cada consulta a OSV (una consulta puede servir a varios objetivos).
#[derive(Debug, Clone)]
pub(super) struct QueryUse {
    pub query: Query,
    pub target: String,
    pub package: String,
    pub installed: String,
    /// Versión completa (con epoch en RPM) para volver a comprobar lo que dice OSV (`rpmver.rs`).
    pub evr: String,
    pub binaries: Vec<String>,
    pub upstream: bool,
    pub reboot: bool,
}

pub(super) struct PkgTarget<'a> {
    pub key: &'a str,
    pub eco: &'a str,
    pub pm: PackageManager,
    pub packages: &'a [Package],
    pub skip: &'a BTreeSet<String>,
}

pub(super) fn package_queries(t: &PkgTarget<'_>, extra_eco: Option<&str>, out: &mut Vec<QueryUse>) {
    let mut groups: BTreeMap<(String, String), Vec<&Package>> = BTreeMap::new();
    for p in t.packages {
        if t.skip.contains(&p.name) {
            continue;
        }
        groups.entry((p.source.clone(), p.source_version.clone())).or_default().push(p);
    }
    let both = t.pm == PackageManager::Rpm && ecosystem::rpm_query_both(t.eco);
    let ecos: Vec<&str> = std::iter::once(t.eco).chain(extra_eco).collect();
    for ((source, sv), bins) in groups {
        let binaries: Vec<String> = bins.iter().map(|b| b.name.clone()).collect();
        let evr = match (t.pm, bins.first()) {
            (PackageManager::Rpm, Some(b)) => rpmver::with_epoch(&b.version, &sv),
            _ => sv.clone(),
        };
        for eco in &ecos {
            let mut names = vec![source.clone()];
            if t.pm != PackageManager::Rpm
                && let Some(alias) = ecosystem::kernel_alias(&source)
            {
                names.push(alias);
            }
            if both {
                for b in &binaries {
                    if !names.contains(b) {
                        names.push(b.clone());
                    }
                }
            }
            for name in names {
                out.push(QueryUse {
                    query: Query { ecosystem: eco.to_string(), name, version: sv.clone() },
                    target: t.key.to_string(),
                    package: source.clone(),
                    installed: sv.clone(),
                    evr: evr.clone(),
                    binaries: binaries.clone(),
                    upstream: false,
                    reboot: false,
                });
            }
        }
    }
}

/// Junta hallazgos por clave.
#[derive(Default)]
pub(super) struct Merger {
    map: BTreeMap<String, Finding>,
}

fn generic_summary(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.ends_with("security update") || l.contains("security update for") || l.ends_with("- security update")
}

pub(super) fn push_unique(v: &mut Vec<String>, items: impl IntoIterator<Item = String>) {
    for i in items {
        if !i.is_empty() && !v.contains(&i) {
            v.push(i);
        }
    }
}

impl Merger {
    pub(super) fn add(&mut self, f: Finding) {
        match self.map.get_mut(&f.key) {
            None => {
                self.map.insert(f.key.clone(), f);
            }
            Some(e) => {
                push_unique(&mut e.aliases, f.aliases);
                push_unique(&mut e.advisories, f.advisories);
                push_unique(&mut e.binaries, f.binaries);
                let from_distro = f.sources.contains(&SourceId::Distro);
                for s in f.sources {
                    if !e.sources.contains(&s) {
                        e.sources.push(s);
                    }
                }
                e.sources.sort();
                if e.installed.is_empty() {
                    e.installed = f.installed;
                }
                if f.fixed.is_some() && (e.fixed.is_none() || from_distro) {
                    e.fixed = f.fixed;
                }
                e.has_fix |= f.has_fix;
                e.unimportant |= f.unimportant;
                let rank = |s: &Option<String>| s.as_deref().and_then(severity::from_text).unwrap_or(Severity::Unknown);
                if rank(&f.distro_severity) < rank(&e.distro_severity) {
                    e.distro_severity = f.distro_severity;
                }
                if f.cvss.unwrap_or(-1.0) > e.cvss.unwrap_or(-1.0) {
                    e.cvss = f.cvss;
                    e.cvss_vector = f.cvss_vector;
                }
                if e.status.is_none() {
                    e.status = f.status;
                }
                let better = match (&e.summary, &f.summary) {
                    (None, Some(_)) => true,
                    (Some(a), Some(b)) => generic_summary(a) && !generic_summary(b),
                    _ => false,
                };
                if better {
                    e.summary = f.summary;
                }
                if e.ecosystem.is_none() {
                    e.ecosystem = f.ecosystem;
                }
            }
        }
    }

    pub(super) fn finish(self) -> Vec<Finding> {
        let mut v: Vec<Finding> = self
            .map
            .into_values()
            .map(|mut f| {
                if f.distro_severity.as_deref().is_some_and(|s| s.trim().eq_ignore_ascii_case("unimportant")) {
                    f.unimportant = true;
                }
                f.severity = severity::combine(f.distro_severity.as_deref(), f.cvss);
                f.advisories.sort();
                f.aliases.retain(|a| a != &f.id && !f.advisories.contains(a));
                f
            })
            .collect();
        v.sort_by(|a, b| a.severity.cmp(&b.severity).then_with(|| a.package.cmp(&b.package)).then_with(|| a.id.cmp(&b.id)));
        v
    }
}

pub(super) fn key(id: &str, package: &str, target: &str) -> String {
    format!("{id}|{package}|{target}")
}

#[allow(clippy::too_many_arguments)]
pub(super) fn new_finding(
    id: &str,
    package: &str,
    target: &str,
    source: SourceId,
    installed: &str,
    kernel: bool,
    ecosystem: Option<&str>,
    upstream: bool,
) -> Finding {
    Finding {
        key: key(id, package, target),
        id: id.to_string(),
        aliases: Vec::new(),
        advisories: Vec::new(),
        package: package.to_string(),
        binaries: Vec::new(),
        installed: installed.to_string(),
        fixed: None,
        has_fix: false,
        severity: Severity::Unknown,
        distro_severity: None,
        cvss: None,
        cvss_vector: None,
        unimportant: false,
        status: None,
        summary: None,
        target: target.to_string(),
        sources: vec![source],
        kernel,
        ecosystem: ecosystem.map(str::to_string),
        upstream,
        needs_reboot: false,
    }
}
