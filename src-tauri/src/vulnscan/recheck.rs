//! «Volver a comprobar» tras arreglar: se vuelven a leer el sistema (detectar, inventario y herramienta
//! de la distro) y se consulta OSV con las versiones que hay AHORA. El sistema y los programas sueltos del
//! informe se cambian por lo nuevo; las imágenes se quedan como estaban (leerlas otra vez tarda mucho y
//! «Actualizar imagen» ya vuelve a analizar la suya). El resultado se guarda como un análisis nuevo en el
//! historial, así al volver a abrir la pestaña no reaparece lo que ya se arregló.
//!
//! Lo que no hay que invalidar: la consulta a OSV (`querybatch`) nunca se guarda en caché y lleva la
//! versión instalada actual; la caché solo guarda el detalle de cada aviso por `id` + `modified`, que no
//! depende de lo instalado (ver la prueba `recheck_drops_what_was_fixed_with_a_warm_cache`).

use std::collections::BTreeSet;

use tokio_util::sync::CancellationToken;

use super::analyze::{summary_of, ProgressFn, DETAILS_FAILED};
use super::model::*;
use super::parse::inventory;
use super::run::analyze_and_save;
use super::store::History;
use crate::error::{AppError, AppResult};

/// Por qué el análisis parcial no sirve para decir qué se arregló (None = sirve). Lo que falte en él tiene
/// que faltar porque ya no está, no porque no se pudo mirar: con el inventario a medias, una fuente que
/// antes respondió y ahora no (OSV.dev caído, la herramienta de la distro falló) o avisos sin detalle,
/// guardarlo daría por arregladas vulnerabilidades que siguen ahí.
pub fn degraded(base: &Report, partial: &Report, input: &ScanInput) -> Option<String> {
    if input.inventory.timed_out || !inventory::parse_inventory(&input.inventory.stdout).complete {
        return Some("el inventario de paquetes llegó incompleto".into());
    }
    if !inventory::parse_detect(&input.detect.stdout).complete {
        return Some("la detección del sistema llegó incompleta".into());
    }
    let used = |r: &Report, id: SourceId| r.sources.iter().any(|s| s.id == id && s.used);
    for id in [SourceId::Osv, SourceId::Distro] {
        if used(base, id) && !used(partial, id) {
            let s = partial.sources.iter().find(|s| s.id == id);
            let label = s.map_or("una fuente", |s| s.label.as_str());
            return Some(format!("{label}: {}", s.and_then(|s| s.note.as_deref()).unwrap_or("no respondió")));
        }
    }
    partial.notes.iter().find(|n| n.phase == "osv" && n.text.starts_with(DETAILS_FAILED)).map(|n| n.text.clone())
}

/// Fases que salen del análisis parcial (sus avisos se cambian por los nuevos).
const SYSTEM_PHASES: &[&str] = &["detect", "inventory", "distro", "osv", "merge"];

fn is_system(kind: TargetKind) -> bool {
    matches!(kind, TargetKind::System | TargetKind::Runtime)
}

/// `base` con el sistema y los programas sueltos de `partial` (un análisis sin imágenes).
/// Es un informe nuevo (otro id y otra fecha).
pub fn merge_system(base: &Report, partial: &Report) -> Report {
    let image_keys: BTreeSet<&str> = base.targets.iter().filter(|t| !is_system(t.kind)).map(|t| t.key.as_str()).collect();
    let mut targets: Vec<Target> = partial.targets.iter().filter(|t| is_system(t.kind)).cloned().collect();
    targets.extend(base.targets.iter().filter(|t| !is_system(t.kind)).cloned());
    let mut findings: Vec<Finding> = partial.findings.iter().filter(|f| !image_keys.contains(f.target.as_str())).cloned().collect();
    findings.extend(base.findings.iter().filter(|f| image_keys.contains(f.target.as_str())).cloned());
    findings.sort_by(|a, b| a.severity.cmp(&b.severity).then_with(|| a.package.cmp(&b.package)).then_with(|| a.id.cmp(&b.id)));

    let mut notes: Vec<ScanNote> = partial.notes.iter().filter(|n| SYSTEM_PHASES.contains(&n.phase.as_str())).cloned().collect();
    notes.extend(base.notes.iter().filter(|n| !SYSTEM_PHASES.contains(&n.phase.as_str())).cloned());
    notes.push(ScanNote::new("merge", NoteLevel::Info, "Sistema vuelto a comprobar; las imágenes son las del análisis anterior"));

    // OSV y la distro: lo de ahora. Trivy solo mira imágenes: el de antes.
    let sources = base
        .sources
        .iter()
        .map(|s| match s.id {
            SourceId::Trivy => s.clone(),
            _ => partial.sources.iter().find(|p| p.id == s.id).cloned().unwrap_or_else(|| s.clone()),
        })
        .collect();
    let mut sample: BTreeSet<OsvQueryView> = partial.osv_sample.iter().cloned().collect();
    sample.extend(base.osv_sample.iter().filter(|q| !partial.osv_sample.iter().any(|p| p.name == q.name && p.ecosystem == q.ecosystem)).cloned());
    Report {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: partial.created_at.clone(),
        duration_ms: partial.duration_ms,
        host: partial.host.clone(),
        programs: partial.programs.clone(),
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

/// Vuelve a comprobar el sistema del informe `report_id` con lo que la interfaz acaba de leer del
/// servidor (`input`, sin imágenes) y lo guarda como un análisis nuevo. Progreso y cancelación como
/// `vulnscan_analyze`.
pub async fn recheck(
    server_id: String,
    report_id: &str,
    input: ScanInput,
    cancel: &CancellationToken,
    progress: ProgressFn<'_>,
) -> AppResult<Report> {
    let history = History::system();
    let base = history.get(&server_id, report_id)?;
    let input = ScanInput { server_id, images: Vec::new(), elevated: base.elevated, ..input };
    let partial = analyze_and_save(&input, cancel, progress, false).await?;
    if let Some(why) = degraded(&base, &partial, &input) {
        return Err(AppError::Invalid(format!(
            "No se pudo volver a comprobar del todo ({why}): el informe anterior se queda como estaba. Vuelve a comprobar en un rato."
        )));
    }
    let merged = merge_system(&base, &partial);
    history.save(&merged)?;
    Ok(merged)
}
