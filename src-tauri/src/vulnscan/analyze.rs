//! Fases 5 y 6: con lo que llegó del servidor, consulta OSV, junta todas las fuentes, quita
//! duplicados por CVE y calcula la gravedad. La fusión de fuentes vive en `analyze_merge.rs`.

use std::collections::{BTreeSet, HashMap};
use std::time::Instant;

use tokio_util::sync::CancellationToken;

use super::analyze_merge::{
    image_label, osv_findings, package_queries, parse_tool, programs, tool_findings, trivy_findings, Merger, PkgTarget, QueryUse,
};
use super::cache::OsvCache;
use super::ecosystem;
use super::kernel;
use super::model::*;
use super::osv::{self, OsvApi, Query};
use super::parse::inventory::{self, Detect, ImageRead};
use crate::error::{AppError, AppResult};

pub use super::analyze_merge::{merge_rescan, summary_of};

/// Progreso: (fase, hechos, total, texto).
pub type ProgressFn<'a> = &'a (dyn Fn(&str, usize, usize, &str) + Send + Sync);

/// Analiza todo. `api` = None si OSV está desactivado.
pub async fn analyze<A: OsvApi>(
    input: &ScanInput,
    api: Option<&A>,
    cache: &OsvCache,
    cancel: &CancellationToken,
    progress: ProgressFn<'_>,
) -> AppResult<Report> {
    let started = Instant::now();
    let mut notes: Vec<ScanNote> = input.notes.clone();
    let detect: Detect = inventory::parse_detect(&input.detect.stdout);
    if !detect.complete {
        notes.push(ScanNote::new("detect", NoteLevel::Warn, "La detección del sistema llegó incompleta"));
    }
    let inv = inventory::parse_inventory(&input.inventory.stdout);
    if !inv.complete {
        notes.push(ScanNote::new(
            "inventory",
            NoteLevel::Warn,
            if input.inventory.timed_out { "El inventario tardó demasiado: puede faltar algo" } else { "El inventario llegó incompleto" },
        ));
    }
    let os = detect.os.clone();
    let eco = ecosystem::for_os(&os);
    let pm = inv.pm.or(detect.pm);
    // Solo el kernel más nuevo cuenta; el que está en uso, si es más viejo, va aparte.
    let ksplit = kernel::split(&inv.packages, pm, &detect.kernel, detect.in_container);
    let host = HostInfo {
        os: os.clone(),
        kernel: detect.kernel.clone(),
        arch: detect.arch.clone(),
        package_manager: pm,
        ecosystem: eco.clone(),
        in_container: detect.in_container,
        tools: detect.tools.clone(),
        reboot_required: detect.reboot_required || ksplit.reboot_to.is_some(),
        reboot_kernel: ksplit.reboot_to.clone(),
    };
    if detect.in_container {
        notes.push(ScanNote::new("detect", NoteLevel::Info, "Es un contenedor: el kernel es el del anfitrión y no se analiza"));
    }

    let mut queries: Vec<QueryUse> = Vec::new();
    let mut targets: Vec<Target> = Vec::new();
    let mut merger = Merger::default();
    let mut reboot_merger = Merger::default();
    let mut sources_used: BTreeSet<SourceId> = BTreeSet::new();

    // ── Sistema ──
    // Paquetes RPM de terceros (vendedor que no es la distro) no se consultan como de la distro.
    let mut skip: BTreeSet<String> = inv
        .vendors
        .iter()
        .filter(|(_, v)| !ecosystem::is_distro_vendor(&os, Some(v)))
        .map(|(n, _)| n.clone())
        .collect();
    for p in &inv.programs {
        if let Some(o) = &p.owner
            && !ecosystem::is_distro_vendor(&os, p.vendor.as_deref())
        {
            skip.insert(o.clone());
        }
    }
    let mut system = Target {
        key: "system".into(),
        kind: TargetKind::System,
        label: "Sistema".into(),
        user: None,
        ecosystem: eco.clone(),
        packages: inv.packages.len() as u32,
        image: None,
        sources: Vec::new(),
        error: None,
    };
    match (&eco, pm) {
        (Some(e), Some(pm)) if !inv.packages.is_empty() => {
            let pro = ecosystem::ubuntu_pro(&os, detect.pro_attached);
            package_queries(&PkgTarget { key: "system", eco: e, pm, packages: &ksplit.current, skip: &skip }, pro.as_deref(), &mut queries);
            let mut running: Vec<QueryUse> = Vec::new();
            package_queries(&PkgTarget { key: "system", eco: e, pm, packages: &ksplit.running_old, skip: &skip }, pro.as_deref(), &mut running);
            queries.extend(running.into_iter().map(|q| QueryUse { reboot: true, ..q }));
        }
        (None, _) => notes.push(ScanNote::new("osv", NoteLevel::Info, ecosystem::no_osv_reason(&os))),
        _ => {}
    }
    if inv.packages.is_empty() {
        system.error = Some("No se pudo leer la lista de paquetes".into());
    }
    if !ksplit.stale.is_empty() {
        notes.push(ScanNote::new(
            "inventory",
            NoteLevel::Info,
            format!("Kernels viejos instalados que no se usan (no se cuentan): {}", ksplit.stale.join(", ")),
        ));
    }
    if host.reboot_required {
        notes.push(ScanNote::new("inventory", NoteLevel::Warn, match &ksplit.reboot_to {
            Some(v) => format!("Hay un kernel nuevo instalado ({v}): reinicia el servidor para usarlo"),
            None => "La distro pide reiniciar el servidor para terminar de aplicar actualizaciones".to_string(),
        }));
    }
    if !skip.is_empty() {
        notes.push(ScanNote::new(
            "inventory",
            NoteLevel::Info,
            format!(
                "Paquetes de repositorios de terceros (no se comparan con la distro): {}",
                skip.iter().take(10).cloned().collect::<Vec<_>>().join(", ")
            ),
        ));
    }

    // ── Programas sueltos ──
    let program_list = programs(&inv, &os, &mut queries);
    let runtime_count = queries.iter().filter(|q| q.target == "runtime").count();

    // ── Herramienta de la distro ──
    let mut tool_label: Option<(DistroTool, Option<String>)> = None;
    if let (Some(tool), Some(out)) = (input.distro_tool, &input.distro_output) {
        match parse_tool(tool, out) {
            Ok(items) => {
                let n = items.len();
                tool_findings(items, &inv, &mut merger);
                system.sources.push(SourceId::Distro);
                sources_used.insert(SourceId::Distro);
                tool_label = Some((tool, None));
                if n == 0 {
                    notes.push(ScanNote::new("distro", NoteLevel::Info, format!("{}: no hay avisos de seguridad pendientes", tool.label())));
                }
            }
            Err(e) => {
                notes.push(ScanNote::new("distro", NoteLevel::Warn, format!("{}: {e}", tool.label())));
                tool_label = Some((tool, Some(e)));
            }
        }
    }

    // ── Imágenes ──
    let mut listings: HashMap<(Option<Engine>, Option<String>), inventory::ImageListing> = HashMap::new();
    for raw in &input.images {
        if let (Some(l), Some(engine)) = (&raw.listing, raw.engine) {
            let parsed = inventory::parse_images(engine, l);
            if let Some(e) = &parsed.error {
                notes.push(ScanNote::new(
                    "images",
                    NoteLevel::Warn,
                    format!("{} de {}: {e}", engine.cmd(), raw.user.as_deref().unwrap_or("tu usuario")),
                ));
            }
            listings.insert((raw.engine, raw.user.clone()), parsed);
        }
    }
    let mut trivy_version: Option<String> = None;
    for raw in input.images.iter().filter(|r| !r.image_id.is_empty()) {
        let short = inventory::short_id(&raw.image_id);
        let user_key = raw.user.clone().unwrap_or_default();
        let engine = raw.engine.unwrap_or(Engine::Podman);
        let tkey = format!("image:{}:{}:{}", engine.cmd(), user_key, short);
        let mut info = listings
            .get(&(raw.engine, raw.user.clone()))
            .and_then(|l| l.images.iter().find(|i| i.id == short))
            .cloned()
            .unwrap_or(ImageInfo { engine: Some(engine), id: short.clone(), ..Default::default() });
        let mut target = Target {
            key: tkey.clone(),
            kind: TargetKind::Image,
            label: image_label(&info, raw.user.as_deref()),
            user: raw.user.clone(),
            ecosystem: None,
            packages: 0,
            image: None,
            sources: Vec::new(),
            error: raw.error.clone(),
        };
        if let Some(out) = &raw.output {
            let read: ImageRead = inventory::parse_image(&out.stdout);
            info.os = Some(read.os.display()).filter(|s| !s.is_empty());
            info.method = read.method.clone();
            let ieco = ecosystem::for_os(&read.os);
            target.ecosystem = ieco.clone();
            if let Some((ver, items)) = &read.trivy {
                trivy_version = trivy_version.or(ver.clone());
                info.method = Some(format!("Trivy {}", ver.clone().unwrap_or_default()).trim().to_string());
                trivy_findings(items, &tkey, &mut merger);
                target.sources.push(SourceId::Trivy);
                sources_used.insert(SourceId::Trivy);
            } else {
                target.packages = read.packages.len() as u32;
                match (&ieco, read.pm) {
                    (Some(e), Some(pm)) if !read.packages.is_empty() => {
                        let none = BTreeSet::new();
                        package_queries(&PkgTarget { key: &tkey, eco: e, pm, packages: &read.packages, skip: &none }, None, &mut queries);
                    }
                    (None, _) if !read.packages.is_empty() => {
                        target.error = Some(format!("{}: sin base de datos en OSV", read.os.display()));
                    }
                    _ => {}
                }
            }
            if target.error.is_none() {
                target.error = read.error.clone().or_else(|| (!read.complete && read.trivy.is_none()).then(|| "lectura incompleta".to_string()));
            }
            if out.timed_out && target.error.is_none() {
                target.error = Some("tardó demasiado".into());
            }
        } else if target.error.is_none() {
            target.error = Some("no se leyó".into());
        }
        target.image = Some(info);
        targets.push(target);
    }
    // Imágenes de los listados que no se leyeron (límite, sin etiqueta y sin uso…).
    let read_ids: BTreeSet<String> = input.images.iter().map(|r| format!("{:?}{:?}{}", r.engine, r.user, inventory::short_id(&r.image_id))).collect();
    let mut skipped = 0;
    for ((engine, user), l) in &listings {
        for i in &l.images {
            if !read_ids.contains(&format!("{:?}{:?}{}", engine, user, i.id)) {
                skipped += 1;
            }
        }
    }
    if skipped > 0 {
        notes.push(ScanNote::new(
            "images",
            NoteLevel::Info,
            format!("{skipped} imágenes no se analizaron (límite de imágenes, o sin etiqueta y sin contenedores)"),
        ));
    }

    // ── OSV ──
    let mut osv_note: Option<String> = None;
    let mut osv_used = false;
    let mut sample: BTreeSet<OsvQueryView> = BTreeSet::new();
    if !queries.is_empty() {
        match (input.use_osv, api) {
            (false, _) | (_, None) => {
                osv_note = Some("desactivado en Ajustes".into());
            }
            (true, Some(api)) => {
                // Consultas únicas.
                let mut uniq: Vec<Query> = queries.iter().map(|q| q.query.clone()).collect();
                uniq.sort();
                uniq.dedup();
                for q in uniq.iter().take(osv::MAX_BATCH) {
                    sample.insert(OsvQueryView { ecosystem: q.ecosystem.clone(), name: q.name.clone(), version: q.version.clone() });
                }
                progress("osv", 0, uniq.len(), &format!("Consultando {} paquetes en OSV.dev", uniq.len()));
                match osv::query_all(api, &uniq, cancel).await {
                    Err(AppError::Canceled) => return Err(AppError::Canceled),
                    Err(e) => {
                        osv_note = Some(format!("no disponible: {e}"));
                        notes.push(ScanNote::new("osv", NoteLevel::Error, format!("OSV.dev no disponible: {e}")));
                    }
                    Ok(outcome) => {
                        for e in &outcome.rejected {
                            notes.push(ScanNote::new("osv", NoteLevel::Warn, format!("OSV no aceptó el ecosistema «{e}»")));
                        }
                        let ids = osv::unique_ids(&outcome.hits);
                        let total = ids.len();
                        let cb = |d: usize, t: usize| progress("osv", d, t, &format!("Detalle de avisos: {d} de {t}"));
                        match osv::fetch_details(api, cache, &ids, cancel, &cb).await {
                            Err(AppError::Canceled) => return Err(AppError::Canceled),
                            Err(e) => {
                                osv_note = Some(format!("no disponible: {e}"));
                                notes.push(ScanNote::new("osv", NoteLevel::Error, format!("OSV.dev no disponible: {e}")));
                            }
                            Ok((details, failed)) => {
                                osv_used = true;
                                if failed > 0 {
                                    notes.push(ScanNote::new(
                                        "osv",
                                        NoteLevel::Warn,
                                        format!("No se pudo leer el detalle de {failed} de {total} avisos"),
                                    ));
                                }
                                let index: HashMap<&Query, usize> = uniq.iter().enumerate().map(|(i, q)| (q, i)).collect();
                                for u in &queries {
                                    let Some(&i) = index.get(&u.query) else { continue };
                                    for h in &outcome.hits[i] {
                                        if let Some(v) = details.get(&h.id) {
                                            let m = if u.reboot { &mut reboot_merger } else { &mut merger };
                                            osv_findings(u, v, m, u.target == "system");
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if osv_used {
        sources_used.insert(SourceId::Osv);
        if eco.is_some() {
            system.sources.insert(0, SourceId::Osv);
        }
        for t in targets.iter_mut().filter(|t| t.ecosystem.is_some() && t.sources.is_empty()) {
            t.sources.push(SourceId::Osv);
        }
    }

    // ── Juntar ──
    progress("merge", 0, 1, "Juntando resultados");
    let findings = kernel::add_reboot_only(merger.finish(), reboot_merger.finish(), ksplit.reboot_to.as_deref());
    let mut all_targets = vec![system];
    if !program_list.is_empty() {
        all_targets.push(Target {
            key: "runtime".into(),
            kind: TargetKind::Runtime,
            label: "Programas sueltos".into(),
            user: None,
            ecosystem: None,
            packages: runtime_count as u32,
            image: None,
            sources: if osv_used && runtime_count > 0 { vec![SourceId::Osv] } else { Vec::new() },
            error: None,
        });
    }
    all_targets.extend(targets);

    let summary = summary_of(&findings);

    let mut sources = vec![SourceInfo {
        id: SourceId::Osv,
        label: "OSV.dev".into(),
        used: osv_used,
        note: osv_note.or_else(|| (!osv_used && queries.is_empty()).then(|| "nada que consultar".into())),
    }];
    match tool_label {
        Some((tool, err)) => sources.push(SourceInfo { id: SourceId::Distro, label: tool.label().into(), used: err.is_none(), note: err }),
        None => sources.push(SourceInfo {
            id: SourceId::Distro,
            label: "Herramienta de la distro".into(),
            used: false,
            note: Some(match ecosystem::distro_tool(&detect) {
                Some(t) => format!("{} no se ejecutó", t.label()),
                None => "no hay ninguna instalada en el servidor".into(),
            }),
        }),
    }
    sources.push(SourceInfo {
        id: SourceId::Trivy,
        label: match &trivy_version {
            Some(v) => format!("Trivy {v}"),
            None => "Trivy".into(),
        },
        used: sources_used.contains(&SourceId::Trivy),
        note: (!sources_used.contains(&SourceId::Trivy)).then(|| {
            if detect.has("trivy") { "no se usó (sin imágenes que analizar)".into() } else { "no está instalado en el servidor".into() }
        }),
    });
    if !input.elevated {
        notes.push(ScanNote::new("images", NoteLevel::Info, "Sin sudo: no se ven los contenedores de otros usuarios ni los de root"));
    }
    if !sources.iter().any(|s| s.used) {
        notes.push(ScanNote::new("merge", NoteLevel::Warn, "Ninguna fuente de vulnerabilidades dio resultados: el informe está vacío"));
    }

    Ok(Report {
        id: uuid::Uuid::new_v4().to_string(),
        server_id: input.server_id.clone(),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        duration_ms: input.server_ms + u64::try_from(started.elapsed().as_millis()).unwrap_or(0),
        elevated: input.elevated,
        host,
        sources,
        targets: all_targets,
        programs: program_list,
        findings,
        summary,
        notes,
        ai: None,
        osv_sample: sample.into_iter().collect(),
    })
}
