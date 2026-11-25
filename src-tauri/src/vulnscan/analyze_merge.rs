//! Fusión de hallazgos de OSV, herramienta de distro y Trivy, construcción de consultas y re-análisis parcial.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::ecosystem;
use super::model::*;
use super::osv::{OsvVuln, Query};
use super::parse::inventory::Inventory;
use super::parse::trivy::TrivyFinding;
use super::parse::{debsecan, dnf, section, sections, ubuntu_pro, zypper, ToolFinding};
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

fn push_unique(v: &mut Vec<String>, items: impl IntoIterator<Item = String>) {
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

fn key(id: &str, package: &str, target: &str) -> String {
    format!("{id}|{package}|{target}")
}

#[allow(clippy::too_many_arguments)]
fn new_finding(
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

/// ¿OSV dio este aviso por la versión sin epoch aunque la instalada ya está arreglada? (`rpmver.rs`)
pub(super) fn already_fixed(u: &QueryUse, v: &OsvVuln) -> bool {
    ecosystem::rpm_epoch_matters(&u.query.ecosystem) && v.rpm_affects(&u.query.ecosystem, &u.query.name, &u.evr) == Some(false)
}

pub(super) fn osv_findings(u: &QueryUse, v: &OsvVuln, merger: &mut Merger, system_target: bool) {
    if already_fixed(u, v) {
        return;
    }
    let eco = &u.query.ecosystem;
    let name = &u.query.name;
    let cves = v.cves();
    let ids: Vec<String> = if cves.is_empty() { vec![v.id.clone()] } else { cves };
    let mut advisories: Vec<String> = Vec::new();
    for x in std::iter::once(&v.id).chain(&v.related).chain(&v.upstream) {
        if ecosystem::is_advisory(x) && !advisories.contains(x) {
            advisories.push(x.clone());
        }
    }
    let others: Vec<String> = v.other_ids().into_iter().filter(|x| !ecosystem::is_advisory(x)).collect();
    let fixed = v.fixed_for(eco, name, &u.installed);
    let dsev = v.distro_severity(eco, name);
    let cvss = v.cvss(eco, name);
    let title = v.title();
    let kernel = system_target && ecosystem::is_kernel(&u.package);
    for id in ids {
        let mut f = new_finding(&id, &u.package, &u.target, SourceId::Osv, &u.installed, kernel, Some(eco), u.upstream);
        f.aliases = others.clone();
        if v.id != id {
            push_unique(&mut f.aliases, [v.id.clone()]);
        }
        f.advisories = advisories.clone();
        f.binaries = u.binaries.clone();
        f.fixed = fixed.clone();
        f.has_fix = fixed.is_some();
        f.distro_severity = dsev.clone();
        f.unimportant = dsev.as_deref().is_some_and(|s| s.eq_ignore_ascii_case("unimportant"));
        if let Some((s, vec)) = &cvss {
            f.cvss = Some(*s);
            f.cvss_vector = Some(vec.clone());
        }
        f.summary = title.clone();
        merger.add(f);
    }
}

pub(super) fn tool_findings(items: Vec<ToolFinding>, inv: &Inventory, merger: &mut Merger) {
    let src_of: HashMap<&str, &Package> = inv.packages.iter().map(|p| (p.name.as_str(), p)).collect();
    for t in items {
        let (source, installed) = match (&t.source, src_of.get(t.package.as_str())) {
            (Some(s), p) => (s.clone(), t.installed.clone().or_else(|| p.map(|p| p.version.clone()))),
            (None, Some(p)) => (p.source.clone(), t.installed.clone().or_else(|| Some(p.version.clone()))),
            (None, None) => (t.package.clone(), t.installed.clone()),
        };
        let ids: Vec<String> = if t.cves.is_empty() { t.advisory.clone().into_iter().collect() } else { t.cves.clone() };
        for id in ids {
            let mut f = new_finding(&id, &source, "system", SourceId::Distro, installed.as_deref().unwrap_or(""), ecosystem::is_kernel(&source), None, false);
            if let Some(a) = &t.advisory
                && a != &id
            {
                f.advisories.push(a.clone());
            }
            f.binaries = vec![t.package.clone()];
            f.fixed = t.fixed.clone();
            f.has_fix = t.has_fix;
            f.distro_severity = t.severity.clone();
            f.cvss = t.cvss;
            f.status = t.status.clone();
            f.summary = t.summary.clone();
            merger.add(f);
        }
    }
}

pub(super) fn trivy_findings(items: &[TrivyFinding], target: &str, merger: &mut Merger) {
    for t in items {
        let mut f = new_finding(&t.id, &t.package, target, SourceId::Trivy, &t.installed, false, None, false);
        f.fixed = t.fixed.clone();
        f.has_fix = t.fixed.is_some() || t.status.as_deref() == Some("fixed");
        f.distro_severity = Some(t.severity.clone()).filter(|s| s != "UNKNOWN");
        f.status = t.status.clone();
        if t.class == "lang-pkgs"
            && let Some(p) = &t.path
        {
            f.binaries = vec![p.clone()];
        }
        merger.add(f);
    }
}

pub(super) fn parse_tool(tool: DistroTool, out: &RawOutput) -> Result<Vec<ToolFinding>, String> {
    let secs = sections(&out.stdout);
    if section(&secs, "end").is_none() {
        return Err(if out.timed_out { "tardó demasiado".into() } else { "la salida llegó incompleta".into() });
    }
    let mut rcs = secs.iter().filter(|(n, _)| n == "rc").filter_map(|(_, l)| l.first().and_then(|s| s.trim().parse::<i32>().ok()));
    let text = |name: &str| super::parse::section_text(&secs, name).unwrap_or_default();
    match tool {
        DistroTool::Dnf4 | DistroTool::Yum => {
            let rc = rcs.next().unwrap_or(0);
            let list = text("list");
            if rc != 0 && list.trim().is_empty() {
                return Err(format!("{} terminó con código {rc}", tool.label()));
            }
            Ok(dnf::findings4(&list, &text("info")))
        }
        DistroTool::Dnf5 => {
            let rc = rcs.next().unwrap_or(0);
            let list = text("list");
            if rc != 0 && list.trim().is_empty() {
                return Err(format!("dnf advisory terminó con código {rc}"));
            }
            Ok(dnf::findings5(&list, &text("info")))
        }
        DistroTool::Debsecan => {
            let rc = rcs.next().unwrap_or(0);
            let t = text("debsecan");
            if rc != 0 && t.trim().is_empty() {
                return Err(format!("debsecan terminó con código {rc} (¿sin acceso a security-tracker.debian.org?)"));
            }
            Ok(debsecan::parse_detail(&t))
        }
        DistroTool::Pro => ubuntu_pro::parse(&text("pro")),
        DistroTool::Zypper => {
            let t = text("zypper");
            if !t.contains("<stream") && !t.contains("<update-status") {
                return Err("zypper no devolvió XML (¿hace falta root para refrescar los repositorios?)".into());
            }
            Ok(zypper::parse(&t))
        }
    }
}

pub(super) fn programs(inv: &Inventory, os: &OsRelease, out_q: &mut Vec<QueryUse>) -> Vec<ProgramInfo> {
    let mut list = Vec::new();
    for p in &inv.programs {
        let third = p.owner.is_some() && !ecosystem::is_distro_vendor(os, p.vendor.as_deref());
        let loose = p.owner.is_none() || third;
        let version = ecosystem::extract_version(&p.name, &p.version_line).or_else(|| Some(p.version_line.clone()).filter(|s| !s.is_empty()));
        let mut info = ProgramInfo {
            name: p.name.clone(),
            path: p.path.clone(),
            version,
            owner: p.owner.clone(),
            third_party: third,
            upstream_ecosystem: None,
        };
        if loose && let Some((eco, name, v)) = ecosystem::upstream(&p.name, &p.version_line) {
            info.upstream_ecosystem = Some(eco.clone());
            out_q.push(QueryUse {
                query: Query { ecosystem: eco, name, version: v.clone() },
                target: "runtime".into(),
                package: p.name.clone(),
                evr: v.clone(),
                installed: v,
                binaries: vec![p.path.clone()],
                upstream: true,
                reboot: false,
            });
        }
        list.push(info);
    }
    list
}

/// Resumen (cuántas de cada gravedad) de una lista de hallazgos.
pub fn summary_of(findings: &[Finding]) -> Summary {
    let mut summary = Summary::default();
    for f in findings {
        if f.unimportant {
            summary.unimportant += 1;
            continue;
        }
        summary.total += 1;
        if f.has_fix {
            summary.with_fix += 1;
        }
        match f.severity {
            Severity::Critical => summary.critical += 1,
            Severity::High => summary.high += 1,
            Severity::Medium => summary.medium += 1,
            Severity::Low => summary.low += 1,
            Severity::Unknown => summary.unknown += 1,
        }
    }
    summary
}

pub(super) fn image_label(img: &ImageInfo, user: Option<&str>) -> String {
    let name = img.tags.first().map(|t| t.as_str()).unwrap_or("(sin etiqueta)");
    match user {
        Some(u) => format!("Imagen {name} ({}) · {u}", img.id),
        None => format!("Imagen {name} ({})", img.id),
    }
}

/// Tras «Actualizar imagen»: el informe `base` con la imagen `old_key` sustituida por las imágenes
/// recién leídas de `partial`.
pub fn merge_rescan(base: &Report, old_key: &str, partial: &Report) -> Report {
    let new_keys: BTreeSet<&str> = partial.targets.iter().filter(|t| t.kind == TargetKind::Image).map(|t| t.key.as_str()).collect();
    let drop = |k: &str| k == old_key || new_keys.contains(k);
    let mut targets: Vec<Target> = base.targets.iter().filter(|t| !drop(&t.key)).cloned().collect();
    targets.extend(partial.targets.iter().filter(|t| t.kind == TargetKind::Image).cloned());
    let mut findings: Vec<Finding> = base.findings.iter().filter(|f| !drop(&f.target)).cloned().collect();
    findings.extend(partial.findings.iter().filter(|f| new_keys.contains(f.target.as_str())).cloned());
    let mut notes = base.notes.clone();
    notes.extend(partial.notes.iter().filter(|n| n.phase == "images" && n.level != NoteLevel::Info).cloned());
    let label = partial.targets.iter().find(|t| t.kind == TargetKind::Image).map(|t| t.label.clone()).unwrap_or_else(|| old_key.to_string());
    notes.push(ScanNote::new("images", NoteLevel::Info, format!("{label}: vuelta a analizar tras «Actualizar imagen»")));
    let mut sources = base.sources.clone();
    for s in sources.iter_mut().filter(|s| !s.used) {
        if let Some(p) = partial.sources.iter().find(|p| p.id == s.id && p.used) {
            *s = p.clone();
        }
    }
    let mut sample: BTreeSet<OsvQueryView> = base.osv_sample.iter().cloned().collect();
    sample.extend(partial.osv_sample.iter().cloned());
    Report {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: partial.created_at.clone(),
        duration_ms: partial.duration_ms,
        summary: summary_of(&findings),
        targets,
        findings,
        notes,
        sources,
        osv_sample: sample.into_iter().collect(),
        ai: None,
        ..base.clone()
    }
}
