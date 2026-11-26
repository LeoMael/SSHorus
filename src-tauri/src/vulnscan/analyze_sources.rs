//! Hallazgos de cada fuente: OSV, la herramienta de seguridad de la distro y Trivy.

use std::collections::HashMap;

use super::analyze_merge::{new_finding, push_unique, Merger, QueryUse};
use super::ecosystem;
use super::model::*;
use super::osv::OsvVuln;
use super::parse::inventory::Inventory;
use super::parse::trivy::TrivyFinding;
use super::parse::{debsecan, dnf, section, sections, ubuntu_pro, zypper, ToolFinding};

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
