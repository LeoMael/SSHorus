//! ¿Tus repositorios ya traen la versión corregida? OSV dice en qué versión se arregló, pero eso no
//! significa que los repositorios habilitados del servidor la tengan (Rocky publica días después que Red
//! Hat; un módulo con otro stream, un repositorio desactivado, `exclude=` o versionlock). Sin esto,
//! «Arreglar» ejecutaba `dnf upgrade`, dnf respondía «Nothing to do» y la vulnerabilidad seguía.
//!
//! Fuente: `dnf check-update` (dnf4, dnf5 y yum; sin root, con la caché de metadatos del usuario)
//! dentro del script de la herramienta de la distro (`scripts::distro_script`).

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::model::{DistroTool, Finding, HostInfo, NoteLevel, RawOutput, ScanNote, SourceId};
use super::parse::{section, sections};
use super::rpmver::cmp_installed;

/// `x86_64_v2`: AlmaLinux 10 para procesadores x86-64 más viejos. Si falta una, sus paquetes parecerían «sin
/// versión corregida en tus repos» y no se ofrecería «Arreglar».
const ARCHES: &[&str] = &["x86_64", "x86_64_v2", "noarch", "i686", "i586", "i386", "aarch64", "ppc64le", "s390x", "armv7hl", "ppc64", "riscv64"];

fn name_of(name_arch: &str) -> Option<&str> {
    let (name, arch) = name_arch.rsplit_once('.')?;
    (ARCHES.contains(&arch) && !name.is_empty()).then_some(name)
}

fn looks_like_version(v: &str) -> bool {
    v.chars().next().is_some_and(|c| c.is_ascii_digit()) && v.contains('-')
}

/// Líneas de `check-update`: «nombre.arch  [epoch:]versión-release  repositorio». dnf4 parte en dos
/// las líneas con nombres largos (el nombre solo y debajo versión y repositorio) y yum, las de versión
/// larga (nombre y versión, y debajo el repositorio). Lo que va después de
/// «Obsoleting Packages» no son actualizaciones. Devuelve nombre → la versión más nueva.
pub fn parse_check_update(text: &str) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    let mut pending: Option<String> = None;
    for line in text.lines() {
        if line.trim_start().starts_with("Obsoleting") {
            break;
        }
        let f: Vec<&str> = line.split_whitespace().collect();
        let (name, version) = match (f.as_slice(), pending.take()) {
            ([n], _) if name_of(n).is_some() => {
                pending = Some((*n).to_string());
                continue;
            }
            ([v, _repo], Some(n)) => (n, (*v).to_string()),
            ([n, v], None) => ((*n).to_string(), (*v).to_string()),
            ([n, v, _repo], _) => ((*n).to_string(), (*v).to_string()),
            _ => continue,
        };
        let Some(name) = name_of(&name) else { continue };
        if !looks_like_version(version.split_once(':').map_or(version.as_str(), |(_, r)| r)) {
            continue;
        }
        match out.get(name) {
            Some(old) if cmp_installed(old, &version) != Ordering::Less => {}
            _ => {
                out.insert(name.to_string(), version);
            }
        }
    }
    out
}

/// Actualizaciones disponibles según la salida del script de la distro. None = no se sabe (otra
/// herramienta, o `check-update` falló: código distinto de 0 = nada y 100 = hay).
pub fn upgrades(tool: DistroTool, out: &RawOutput) -> Option<BTreeMap<String, String>> {
    if !matches!(tool, DistroTool::Dnf4 | DistroTool::Dnf5 | DistroTool::Yum) {
        return None;
    }
    let secs = sections(&out.stdout);
    let rc = section(&secs, "uprc")?.first()?.trim().parse::<i32>().ok()?;
    if rc != 0 && rc != 100 {
        return None;
    }
    let text = section(&secs, "upgrades").map(|l| l.join("\n")).unwrap_or_default();
    let up = parse_check_update(&text);
    // 100 = hay actualizaciones: si no se entendió ninguna, no se sabe (no «tus repos no traen nada»).
    (rc == 0 || !up.is_empty()).then_some(up)
}

/// Hallazgos (clave) con versión corregida publicada que tus repositorios aún no ofrecen: ningún
/// paquete binario suyo tiene una actualización que llegue a la versión corregida. Los que da la propia
/// herramienta de la distro ya están en los repositorios; los que se arreglan reiniciando, también.
pub fn missing_fixes(findings: &[Finding], upgrades: &BTreeMap<String, String>) -> Vec<String> {
    findings
        .iter()
        .filter(|f| f.target == "system" && f.has_fix && !f.needs_reboot && !f.upstream && !f.sources.contains(&SourceId::Distro))
        .filter(|f| {
            let Some(fixed) = f.fixed.as_deref() else { return false };
            !f.binaries.iter().filter_map(|b| upgrades.get(b)).any(|v| cmp_installed(v, fixed) != Ordering::Less)
        })
        .map(|f| f.key.clone())
        .collect()
}


/// Apunta en `host` qué hallazgos no tienen todavía la versión corregida en los repositorios (si se
/// leyeron sus actualizaciones) y devuelve el aviso para el informe.
pub fn apply(host: &mut HostInfo, findings: &[Finding]) -> Option<ScanNote> {
    host.no_repo_fix = missing_fixes(findings, host.repo_upgrades.as_ref()?);
    let n = host.no_repo_fix.len();
    (n > 0).then(|| {
        ScanNote::new("distro", NoteLevel::Info, format!("{n} vulnerabilidades tienen versión corregida publicada que tus repositorios aún no ofrecen"))
    })
}
