//! Kernels instalados: cuál cuenta para el análisis y si hace falta reiniciar.
//!
//! Las distros guardan varios kernels a la vez (RPM los instala uno al lado del otro y deja 3; Debian y
//! Ubuntu cambian el nombre del paquete en cada versión y el viejo queda hasta `autoremove`). Si se
//! consultaran todos, las vulnerabilidades del kernel viejo seguirían en el informe para siempre aunque
//! ya se haya actualizado. Por eso:
//! - solo se consulta la versión **más nueva** de cada paquete del kernel;
//! - si el kernel **en uso** (`uname -r`) es más viejo, sus avisos se consultan aparte: los que el nuevo
//!   ya no tiene se marcan «se arregla al reiniciar»;
//! - las demás versiones viejas (ni la nueva ni la que está en uso) no cuentan.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use super::ecosystem::is_kernel;
use super::model::{Finding, Package, PackageManager};
use super::osv::cmp_versions;

#[derive(Debug, Default, PartialEq)]
pub struct KernelSplit {
    /// Paquetes que se consultan como siempre (sin las versiones viejas del kernel).
    pub current: Vec<Package>,
    /// Paquetes del kernel en uso cuando hay uno más nuevo instalado.
    pub running_old: Vec<Package>,
    /// Versiones viejas que ni se usan ni se cuentan («kernel 5.14.0-70.el9»).
    pub stale: Vec<String>,
    /// Versión del kernel nuevo si hay que reiniciar para usarlo.
    pub reboot_to: Option<String>,
}

const ARCHES: &[&str] = &["x86_64", "aarch64", "ppc64le", "s390x", "i686", "i586", "armv7hl", "noarch"];

/// ¿La versión `v` del paquete fuente `source` es la del kernel en uso (`uname -r`)?
fn is_running(pm: PackageManager, uname_r: &str, v: &str, binaries: &[&Package]) -> bool {
    match pm {
        // «5.14.0-427.13.1.el9_4» ↔ «5.14.0-427.13.1.el9_4.x86_64».
        PackageManager::Rpm => uname_r.strip_prefix(v).is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '+'])),
        // El nombre del paquete lleva el `uname -r`: «linux-image-6.1.0-18-amd64».
        PackageManager::Dpkg => binaries.iter().any(|b| {
            let n = b.name.as_str();
            n.ends_with(&format!("-{uname_r}")) || n.ends_with(&format!("-{uname_r}-unsigned"))
        }),
        // «6.6.31-r0» ↔ «6.6.31-0-lts».
        PackageManager::Apk => apk_uname(v).is_some_and(|u| uname_r.strip_prefix(&u).is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))),
        PackageManager::None => false,
    }
}

fn apk_uname(v: &str) -> Option<String> {
    let (base, rel) = v.rsplit_once("-r")?;
    Some(format!("{base}-{rel}"))
}

/// Versión del paquete del kernel que corresponde a `uname -r` cuando ya no está instalado
/// (Alpine lo reemplaza al actualizar; en RPM pudo borrarse). None si no se puede saber.
fn version_from_uname(pm: PackageManager, uname_r: &str) -> Option<String> {
    match pm {
        PackageManager::Rpm => {
            let (base, arch) = uname_r.rsplit_once('.')?;
            ARCHES.contains(&arch).then(|| base.to_string())
        }
        PackageManager::Apk => {
            // «6.6.31-0-lts» → «6.6.31-r0».
            let mut it = uname_r.splitn(3, '-');
            let (ver, rel) = (it.next()?, it.next()?);
            rel.chars().all(|c| c.is_ascii_digit()).then(|| format!("{ver}-r{rel}"))
        }
        _ => None,
    }
}

/// Reparte los paquetes del sistema. `uname_r` vacío o `in_container` = no se sabe cuál está en uso.
pub fn split(packages: &[Package], pm: Option<PackageManager>, uname_r: &str, in_container: bool) -> KernelSplit {
    let pm = pm.unwrap_or(PackageManager::None);
    let uname_r = if in_container { "" } else { uname_r.trim() };
    // Paquete fuente del kernel → versión → binarios.
    let mut kernels: BTreeMap<&str, BTreeMap<&str, Vec<&Package>>> = BTreeMap::new();
    for p in packages.iter().filter(|p| is_kernel(&p.source)) {
        kernels.entry(&p.source).or_default().entry(&p.source_version).or_default().push(p);
    }
    let mut out = KernelSplit::default();
    let mut keep: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (src, versions) in &kernels {
        let Some(newest) = versions.keys().copied().max_by(|a, b| cmp_versions(a, b)) else { continue };
        keep.insert((src, newest));
        let running = if uname_r.is_empty() {
            None
        } else {
            versions.iter().find(|(v, bins)| is_running(pm, uname_r, v, bins)).map(|(v, _)| *v)
        };
        for (v, bins) in versions {
            if *v == newest {
                continue;
            }
            if Some(*v) == running {
                out.running_old.extend(bins.iter().map(|b| (*b).clone()));
                out.reboot_to = Some(newest.to_string());
            } else {
                out.stale.push(format!("{src} {v}"));
            }
        }
        // El kernel en uso ya no está instalado (Alpine lo reemplaza): se consulta con su versión.
        if running.is_none()
            && !uname_r.is_empty()
            && let Some(v) = version_from_uname(pm, uname_r)
            && cmp_versions(&v, newest) == Ordering::Less
            && matches_flavor(pm, src, uname_r)
        {
            out.running_old.extend(versions[newest].iter().map(|b| Package { version: v.clone(), source_version: v.clone(), ..(*b).clone() }));
            out.reboot_to = Some(newest.to_string());
        }
    }
    out.current = packages.iter().filter(|p| !is_kernel(&p.source) || keep.contains(&(p.source.as_str(), p.source_version.as_str()))).cloned().collect();
    out
}

/// El paquete `src` es el del kernel en uso: en Alpine, «linux-lts» para «…-lts»; en RPM, «kernel».
fn matches_flavor(pm: PackageManager, src: &str, uname_r: &str) -> bool {
    match pm {
        PackageManager::Apk => src.strip_prefix("linux-").is_some_and(|f| uname_r.ends_with(&format!("-{f}"))),
        PackageManager::Rpm => src == "kernel",
        _ => false,
    }
}

/// Añade los avisos del kernel en uso que el kernel nuevo ya no tiene: se arreglan al reiniciar.
/// Los que también tiene el nuevo ya están en `findings` (siguen después de reiniciar).
pub fn add_reboot_only(mut findings: Vec<Finding>, running: Vec<Finding>, reboot_to: Option<&str>) -> Vec<Finding> {
    let keys: BTreeSet<String> = findings.iter().map(|f| f.key.clone()).collect();
    for mut f in running.into_iter().filter(|f| !keys.contains(&f.key)) {
        f.needs_reboot = true;
        f.has_fix = true;
        if let Some(v) = reboot_to {
            f.fixed = Some(v.to_string());
        }
        findings.push(f);
    }
    findings.sort_by(|a, b| a.severity.cmp(&b.severity).then_with(|| a.package.cmp(&b.package)).then_with(|| a.id.cmp(&b.id)));
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkg(name: &str, source: &str, v: &str) -> Package {
        Package { name: name.into(), source: source.into(), version: v.into(), source_version: v.into(), arch: None }
    }

    #[test]
    fn rpm_keeps_only_the_newest_kernel_and_knows_the_running_one() {
        let pkgs = vec![
            pkg("kernel-core", "kernel", "5.14.0-70.13.1.el9_0"),
            pkg("kernel-core", "kernel", "5.14.0-427.13.1.el9_4"),
            pkg("kernel-core", "kernel", "5.14.0-503.11.1.el9_5"),
            pkg("kernel-modules", "kernel", "5.14.0-503.11.1.el9_5"),
            pkg("curl", "curl", "7.76.1-29.el9"),
        ];
        let s = split(&pkgs, Some(PackageManager::Rpm), "5.14.0-427.13.1.el9_4.x86_64", false);
        assert_eq!(s.current.len(), 3, "kernel nuevo (2 binarios) + curl");
        assert!(s.current.iter().all(|p| p.source != "kernel" || p.source_version == "5.14.0-503.11.1.el9_5"));
        assert_eq!(s.running_old, vec![pkgs[1].clone()]);
        assert_eq!(s.stale, ["kernel 5.14.0-70.13.1.el9_0"]);
        assert_eq!(s.reboot_to.as_deref(), Some("5.14.0-503.11.1.el9_5"));

        // Ya se reinició con el nuevo: nada que reiniciar; los dos viejos no cuentan.
        let s = split(&pkgs, Some(PackageManager::Rpm), "5.14.0-503.11.1.el9_5.x86_64", false);
        assert!(s.running_old.is_empty());
        assert_eq!(s.reboot_to, None);
        assert_eq!(s.stale.len(), 2);
        // «427.1» no debe confundirse con «427.13.1».
        assert!(!is_running(PackageManager::Rpm, "5.14.0-427.13.1.el9_4.x86_64", "5.14.0-427.1", &[]));
    }

    #[test]
    fn rpm_running_kernel_already_removed() {
        let pkgs = vec![pkg("kernel-core", "kernel", "5.14.0-503.11.1.el9_5")];
        let s = split(&pkgs, Some(PackageManager::Rpm), "5.14.0-427.13.1.el9_4.x86_64", false);
        assert_eq!(s.running_old.len(), 1);
        assert_eq!(s.running_old[0].source_version, "5.14.0-427.13.1.el9_4");
        assert_eq!(s.reboot_to.as_deref(), Some("5.14.0-503.11.1.el9_5"));
    }

    #[test]
    fn debian_kernel_by_package_name() {
        let pkgs = vec![
            Package { name: "linux-image-6.1.0-18-amd64".into(), source: "linux-signed-amd64".into(), version: "6.1.76-1".into(), source_version: "6.1.76+1".into(), arch: None },
            Package { name: "linux-image-6.1.0-20-amd64".into(), source: "linux-signed-amd64".into(), version: "6.1.85-1".into(), source_version: "6.1.85+1".into(), arch: None },
            Package { name: "linux-image-amd64".into(), source: "linux-signed-amd64".into(), version: "6.1.85-1".into(), source_version: "6.1.85+1".into(), arch: None },
        ];
        let s = split(&pkgs, Some(PackageManager::Dpkg), "6.1.0-18-amd64", false);
        assert_eq!(s.current.len(), 2);
        assert_eq!(s.running_old.len(), 1);
        assert_eq!(s.reboot_to.as_deref(), Some("6.1.85+1"));
        // En un contenedor no se sabe qué kernel se usa: solo cuenta el nuevo, sin pedir reinicio.
        let s = split(&pkgs, Some(PackageManager::Dpkg), "6.1.0-18-amd64", true);
        assert!(s.running_old.is_empty() && s.reboot_to.is_none());
        assert_eq!(s.stale.len(), 1);
    }

    #[test]
    fn alpine_kernel_replaced_in_place() {
        let pkgs = vec![pkg("linux-lts", "linux-lts", "6.6.32-r0"), pkg("musl", "musl", "1.2.5-r0")];
        let s = split(&pkgs, Some(PackageManager::Apk), "6.6.31-0-lts", false);
        assert_eq!(s.running_old.len(), 1);
        assert_eq!(s.running_old[0].source_version, "6.6.31-r0");
        assert_eq!(s.reboot_to.as_deref(), Some("6.6.32-r0"));
        let s = split(&pkgs, Some(PackageManager::Apk), "6.6.32-0-lts", false);
        assert!(s.running_old.is_empty() && s.reboot_to.is_none());
        // Otro sabor (virt) no es este paquete.
        let s = split(&pkgs, Some(PackageManager::Apk), "6.6.31-0-virt", false);
        assert!(s.reboot_to.is_none());
    }
}
