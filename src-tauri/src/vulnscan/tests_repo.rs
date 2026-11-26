//! Pruebas de «sigue apareciendo aunque lo arreglé»: versiones RPM (epoch, `~`, `^`, «el9_x»), avisos
//! de OSV que se dan por pendientes porque se preguntó sin epoch, si los repositorios ya traen la versión
//! corregida (`dnf check-update`) y el kernel con el que se arranca.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::analyze::analyze;
use super::cache::OsvCache;
use super::kernel;
use super::model::*;
use super::osv::{BatchItem, Hit, OsvApi, OsvError, OsvVuln, Query};
use super::parse::inventory::parse_detect;
use super::repo;
use super::rpmver::{cmp_installed, rpmvercmp, with_epoch};

#[test]
fn rpm_version_comparison_like_rpm() {
    use Ordering::*;
    let cases = [
        ("1.0", "1.0", Equal),
        ("1.0", "2.0", Less),
        ("2.0.1", "2.0", Greater),
        ("1.01", "1.1", Equal),
        ("10", "9", Greater),
        ("1.0~rc1", "1.0", Less),
        ("1.0~rc1", "1.0~rc2", Less),
        ("1.0^git1", "1.0", Greater),
        ("1.0^git1", "1.0.1", Less),
        ("27.el9_4", "27.el9_5", Less),
        ("27.el9_10", "27.el9_9", Greater),
        ("1.el9", "1.el9_1", Less),
        ("427.13.1.el9_4", "503.11.1.el9_5", Less),
        ("6.el9.rocky.0.2", "6.el9", Greater),
        ("a", "1", Less),
        ("1.0a", "1.0", Greater),
    ];
    for (a, b, want) in cases {
        assert_eq!(rpmvercmp(a, b), want, "{a} vs {b}");
        assert_eq!(rpmvercmp(b, a), want.reverse(), "{b} vs {a}");
    }
}

#[test]
fn epoch_counts_when_written() {
    // El fallo de antes: sin epoch, la 3.5.1 «era más vieja» que la 1:3.0.1 y el aviso no se iba nunca.
    assert_eq!(cmp_installed("3.5.1-4.el9_7", "1:3.0.1-43.el9_0"), Ordering::Less);
    assert_eq!(cmp_installed("1:3.5.1-4.el9_7", "1:3.0.1-43.el9_0"), Ordering::Greater);
    // Epoch 0 escrito («0:») cuenta; un dato que no lo escribe se compara sin él.
    assert_eq!(cmp_installed("1:3.0.7-27.el9", "0:3.0.7-6.el9_5"), Ordering::Greater);
    assert_eq!(cmp_installed("2:4.9-3.el9", "4.9-15.el9"), Ordering::Less);
    assert_eq!(cmp_installed("7.76.1-26.el9", "0:7.76.1-14.el9_0.5"), Ordering::Greater);
    assert_eq!(with_epoch("1:3.0.7-27.el9", "3.0.7-27.el9"), "1:3.0.7-27.el9");
    assert_eq!(with_epoch("7.76.1-26.el9", "7.76.1-26.el9"), "7.76.1-26.el9");
}

fn rocky_advisory(id: &str, cve: &str, name: &str, fixed: &str) -> Value {
    json!({"id": id, "modified": "2026-01-01T00:00:00Z", "upstream": [cve], "summary": "Important: openssl security update",
           "affected": [{"package": {"ecosystem": "Rocky Linux:9", "name": name},
                         "ranges": [{"type": "ECOSYSTEM", "events": [{"introduced": "0"}, {"fixed": fixed}]}]}]})
}

#[test]
fn osv_ranges_checked_with_the_full_version() {
    let v: OsvVuln = serde_json::from_value(rocky_advisory("RLSA-2022:7288", "CVE-2022-3602", "openssl", "1:3.0.1-43.el9_0")).unwrap();
    assert_eq!(v.rpm_affects("Rocky Linux:9", "openssl", "1:3.0.1-23.el9_0"), Some(true));
    assert_eq!(v.rpm_affects("Rocky Linux:9", "openssl", "1:3.0.7-27.el9"), Some(false));
    assert_eq!(v.rpm_affects("Rocky Linux:9", "openssl", "1:3.0.1-43.el9_0"), Some(false), "la versión arreglada ya no está afectada");
    assert_eq!(v.rpm_affects("Rocky Linux:9", "otro", "1:3.0.7-27.el9"), None, "sin rangos de ese paquete: se cree a OSV");
    // El aviso real de Rocky (curl, con «0:» delante).
    let curl: OsvVuln = serde_json::from_str(include_str!("fixtures/osv/RLSA-2022_6157.json")).unwrap();
    assert_eq!(curl.rpm_affects("Rocky Linux:9", "curl", "7.76.1-14.el9_0.4"), Some(true));
    assert_eq!(curl.rpm_affects("Rocky Linux:9", "curl", "7.76.1-26.el9"), Some(false));
}

/// OSV como la de verdad cuando se pregunta sin epoch: da por afectado todo lo que tiene epoch.
struct EpochBlindOsv;

impl OsvApi for EpochBlindOsv {
    async fn querybatch(&self, queries: &[(Query, Option<String>)]) -> Result<Vec<BatchItem>, OsvError> {
        let hit = |id: &str| Hit { id: id.into(), modified: "2026-01-01T00:00:00Z".into() };
        Ok(queries
            .iter()
            .map(|(q, _)| BatchItem {
                vulns: if q.name == "openssl" { vec![hit("RLSA-OLD"), hit("RLSA-NEW")] } else { vec![] },
                next_page_token: None,
            })
            .collect())
    }

    async fn vuln(&self, id: &str) -> Result<Value, OsvError> {
        Ok(match id {
            "RLSA-OLD" => rocky_advisory(id, "CVE-2022-3602", "openssl", "1:3.0.1-43.el9_0"),
            "RLSA-NEW" => rocky_advisory(id, "CVE-2026-2001", "openssl", "1:3.5.1-9.el9_7"),
            _ => return Err(OsvError::NotFound),
        })
    }
}

fn input(openssl_vr: &str, upgrades: Option<&str>) -> ScanInput {
    let detect = format!(
        "@@os\n{}\n@@kernel\nLinux 5.14.0-570.el9.x86_64 x86_64\n@@id\nana\n1000\n@@container\nno\n@@pm\nrpm\n@@tools\n@@end\n",
        include_str!("fixtures/os-release-rockylinux.txt")
    );
    let (v, r) = openssl_vr.split_once('-').unwrap();
    let inventory = format!(
        "@@pm\nrpm\n@@pkgs\nopenssl-libs\t1\t{v}\t{r}\tx86_64\topenssl-{openssl_vr}.src.rpm\tRocky Enterprise Software Foundation\n@@tools\n@@home\n@@end\n"
    );
    let distro = upgrades.map(|u| RawOutput {
        stdout: format!("@@list\n@@rc 0\n@@info\n@@rc 0\n@@upgrades\n{u}\n@@uprc {}\n@@end\n", if u.trim().is_empty() { 0 } else { 100 }),
        ..Default::default()
    });
    ScanInput {
        server_id: "srv-repo".into(),
        detect: RawOutput { stdout: detect, ..Default::default() },
        inventory: RawOutput { stdout: inventory, ..Default::default() },
        distro_tool: distro.as_ref().map(|_| DistroTool::Dnf4),
        distro_output: distro,
        use_osv: true,
        ..Default::default()
    }
}

async fn scan(i: &ScanInput) -> Report {
    let p = |_: &str, _: usize, _: usize, _: &str| {};
    analyze(i, Some(&EpochBlindOsv), &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap()
}

#[tokio::test]
async fn what_was_fixed_does_not_come_back_because_of_the_epoch() {
    let r = scan(&input("3.5.1-4.el9_7", None)).await;
    assert!(r.findings.iter().all(|f| f.id != "CVE-2022-3602"), "ya arreglada en 1:3.0.1-43: no se muestra");
    let new = r.findings.iter().find(|f| f.id == "CVE-2026-2001").expect("la que sigue pendiente");
    assert!(new.has_fix);
    assert_eq!(new.binaries, ["openssl-libs"]);
    // Sin saber qué traen los repositorios no se dice nada de ellos.
    assert_eq!(r.host.repo_upgrades, None);
    assert!(r.host.no_repo_fix.is_empty());

    let r = scan(&input("3.0.1-23.el9_0", None)).await;
    assert!(r.findings.iter().any(|f| f.id == "CVE-2022-3602"), "versión vieja de verdad: sí está");
}

#[tokio::test]
async fn fix_not_in_your_repositories_yet() {
    let key = "CVE-2026-2001|openssl|system";
    // Los repositorios no traen ninguna openssl nueva: la corregida aún no está.
    let r = scan(&input("3.5.1-4.el9_7", Some("curl.x86_64  7.76.1-31.el9_6.1  baseos"))).await;
    assert_eq!(r.host.no_repo_fix, [key]);
    assert!(r.notes.iter().any(|n| n.text.contains("tus repositorios aún no ofrecen")));
    // Traen una más nueva, pero todavía no la corregida.
    let r = scan(&input("3.5.1-4.el9_7", Some("openssl-libs.x86_64  1:3.5.1-7.el9_7  baseos"))).await;
    assert_eq!(r.host.no_repo_fix, [key]);
    assert_eq!(r.host.repo_upgrades.as_ref().and_then(|u| u.get("openssl-libs")).map(String::as_str), Some("1:3.5.1-7.el9_7"));
    // Traen la corregida: «Arreglar» va a funcionar.
    let r = scan(&input("3.5.1-4.el9_7", Some("openssl-libs.x86_64  1:3.5.1-9.el9_7  baseos"))).await;
    assert!(r.host.no_repo_fix.is_empty());
    // Ninguna actualización (código 0): tampoco está.
    let r = scan(&input("3.5.1-4.el9_7", Some(""))).await;
    assert_eq!(r.host.no_repo_fix, [key]);
}

#[test]
fn check_update_output() {
    let up = repo::parse_check_update(include_str!("fixtures/dnf4-check-update-rocky.txt"));
    assert_eq!(up.get("openssl-libs").map(String::as_str), Some("1:3.2.2-6.el9_5.1"), "la más nueva de las dos arquitecturas");
    assert_eq!(up.get("kernel-core").map(String::as_str), Some("5.14.0-570.25.1.el9_6"));
    assert_eq!(up.get("python3-libselinux-something-long").map(String::as_str), Some("3.6-1.el9"), "línea partida en dos");
    assert!(!up.contains_key("grub2-tools"), "lo de «Obsoleting Packages» no cuenta");
    assert_eq!(up.len(), 8);
    let raw = |rc: &str| RawOutput { stdout: format!("@@upgrades\ncurl.x86_64 7.76.1-31.el9 baseos\n@@uprc {rc}\n@@end\n"), ..Default::default() };
    assert_eq!(repo::upgrades(DistroTool::Dnf4, &raw("100")).map(|u| u.len()), Some(1));
    assert_eq!(repo::upgrades(DistroTool::Dnf4, &raw("1")), None, "dnf falló: no se sabe");
    assert_eq!(repo::upgrades(DistroTool::Debsecan, &raw("100")), None);
    let odd = RawOutput { stdout: "@@upgrades\nalgo que no se entiende\n@@uprc 100\n@@end\n".into(), ..Default::default() };
    assert_eq!(repo::upgrades(DistroTool::Dnf4, &odd), None, "hay actualizaciones pero no se entendió ninguna: no se sabe");
    // AlmaLinux 10 x86_64_v2 y la versión larga partida por yum (el repositorio en la línea de abajo).
    let up = repo::parse_check_update("glibc.x86_64_v2   2.39-37.el10_0   baseos\nsome-package.x86_64   1:2.34.0-10000.el7_9.longrelease\n    updates\n");
    assert_eq!(up.get("glibc").map(String::as_str), Some("2.39-37.el10_0"));
    assert_eq!(up.get("some-package").map(String::as_str), Some("1:2.34.0-10000.el7_9.longrelease"));
}

#[test]
fn missing_fixes_skips_what_the_distro_tool_or_a_reboot_already_covers() {
    let base = |id: &str| Finding {
        key: format!("{id}|kernel|system"),
        id: id.into(),
        aliases: vec![],
        advisories: vec![],
        package: "kernel".into(),
        binaries: vec!["kernel-core".into(), "kernel-modules".into()],
        installed: "5.14.0-503.11.1.el9_5".into(),
        fixed: Some("5.14.0-570.25.1.el9_6".into()),
        has_fix: true,
        severity: Severity::High,
        distro_severity: None,
        cvss: None,
        cvss_vector: None,
        unimportant: false,
        status: None,
        summary: None,
        target: "system".into(),
        sources: vec![SourceId::Osv],
        kernel: true,
        ecosystem: None,
        upstream: false,
        needs_reboot: false,
    };
    let mut up: BTreeMap<String, String> = BTreeMap::new();
    let a = base("CVE-1");
    let reboot = Finding { needs_reboot: true, ..base("CVE-2") };
    let distro = Finding { sources: vec![SourceId::Distro, SourceId::Osv], ..base("CVE-3") };
    let all = [a, reboot, distro];
    assert_eq!(repo::missing_fixes(&all, &up), ["CVE-1|kernel|system"]);
    up.insert("kernel-modules".into(), "5.14.0-570.25.1.el9_6".into());
    assert!(repo::missing_fixes(&all, &up).is_empty(), "basta con que un binario llegue a la corregida");
}

fn pkg(name: &str, v: &str) -> Package {
    Package { name: name.into(), source: "kernel".into(), version: v.into(), source_version: v.into(), arch: None }
}

#[test]
fn every_kernel_subpackage_follows_the_newest_kernel() {
    const OLD: &str = "5.14.0-427.13.1.el9_4";
    const RUN: &str = "5.14.0-503.11.1.el9_5";
    const NEW: &str = "5.14.0-570.25.1.el9_6";
    let mut pkgs = Vec::new();
    for v in [OLD, RUN, NEW] {
        for n in ["kernel", "kernel-core", "kernel-modules", "kernel-modules-core", "kernel-devel"] {
            pkgs.push(pkg(n, v));
        }
    }
    // Estos no se instalan uno al lado del otro: solo está la versión nueva.
    pkgs.push(pkg("kernel-headers", NEW));
    pkgs.push(pkg("kernel-tools", NEW));
    let s = kernel::split(&pkgs, Some(PackageManager::Rpm), &format!("{RUN}.x86_64"), false);
    assert_eq!(s.current.len(), 7, "solo el kernel nuevo (5 paquetes) + headers y tools");
    assert!(s.current.iter().all(|p| p.source_version == NEW));
    assert_eq!(s.running_old.len(), 5, "los del kernel en uso, aparte");
    assert!(s.running_old.iter().all(|p| p.source_version == RUN));
    assert_eq!(s.stale, [format!("kernel {OLD}")]);
    assert_eq!(s.reboot_to.as_deref(), Some(NEW));

    // Tras reiniciar con el nuevo: nada pendiente de reinicio y los viejos no cuentan.
    let s = kernel::split(&pkgs, Some(PackageManager::Rpm), &format!("{NEW}.x86_64"), false);
    assert!(s.running_old.is_empty() && s.reboot_to.is_none());
    assert_eq!(s.stale.len(), 2);
}

#[test]
fn boot_entry_that_does_not_change() {
    let new = "5.14.0-570.25.1.el9_6";
    let old = "5.14.0-503.11.1.el9_5.x86_64";
    let n = kernel::boot_note(Some(new), Some(old), old).expect("aviso");
    assert!(n.contains("grubby --set-default /boot/vmlinuz-5.14.0-570.25.1.el9_6.x86_64"), "{n}");
    assert_eq!(kernel::boot_note(Some(new), Some(&format!("{new}.x86_64")), old), None, "arrancará el nuevo");
    assert_eq!(kernel::boot_note(None, Some(old), old), None, "ya se usa el predeterminado");
    assert_eq!(kernel::boot_note(Some(new), None, old), None, "sin grubby no se sabe");

    let d = parse_detect("@@kernel\nLinux 5.14.0-503.11.1.el9_5.x86_64 x86_64\n@@bootid\n0f1e2d3c-aaaa\n@@bootkernel\n/boot/vmlinuz-5.14.0-570.25.1.el9_6.x86_64\n@@end\n");
    assert_eq!(d.boot_kernel.as_deref(), Some("5.14.0-570.25.1.el9_6.x86_64"));
    assert_eq!(d.boot_id.as_deref(), Some("0f1e2d3c-aaaa"));
    let d = parse_detect("@@bootkernel\ngrubby: permiso denegado\n@@end\n");
    assert_eq!(d.boot_kernel, None);
}
