//! Piezas del informe: programas clave, resumen por gravedad, nombre de cada imagen y el re-análisis
//! de una imagen tras «Actualizar imagen».

use std::collections::BTreeSet;

use super::analyze_merge::QueryUse;
use super::ecosystem;
use super::model::*;
use super::osv::Query;
use super::parse::inventory::Inventory;

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
