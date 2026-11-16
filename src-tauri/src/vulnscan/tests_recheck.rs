//! Pruebas de «lo arreglado desaparece»: kernels viejos, «se arregla al reiniciar» y volver a comprobar
//! el sistema con la caché de OSV ya llena. Con una OSV falsa que SÍ mira la versión (como la real).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::analyze::analyze;
use super::cache::OsvCache;
use super::model::*;
use super::osv::{BatchItem, Hit, OsvApi, OsvError, Query};
use super::recheck::merge_system;
use super::store::History;

const ECO: &str = "Rocky Linux:9";
const OLD_K: &str = "5.14.0-427.13.1.el9_4";
const NEW_K: &str = "5.14.0-503.11.1.el9_5";
const ANCIENT_K: &str = "5.14.0-70.13.1.el9_0";

/// OSV falsa: (nombre, versión) → ids, como hace la de verdad con `querybatch`.
#[derive(Default)]
struct VersionedOsv {
    db: HashMap<(String, String), Vec<String>>,
    vulns: HashMap<String, Value>,
    vuln_calls: AtomicUsize,
}

impl VersionedOsv {
    fn add(&mut self, name: &str, version: &str, id: &str) {
        self.db.entry((name.into(), version.into())).or_default().push(id.into());
    }

    fn advisory(&mut self, id: &str, cve: &str, name: &str, fixed: &str) {
        self.vulns.insert(
            id.into(),
            json!({"id": id, "modified": "2026-01-01T00:00:00Z", "upstream": [cve], "summary": "Important: security update",
                   "affected": [{"package": {"ecosystem": ECO, "name": name},
                                 "ranges": [{"type": "ECOSYSTEM", "events": [{"introduced": "0"}, {"fixed": fixed}]}]}]}),
        );
    }
}

impl OsvApi for VersionedOsv {
    async fn querybatch(&self, queries: &[(Query, Option<String>)]) -> Result<Vec<BatchItem>, OsvError> {
        Ok(queries
            .iter()
            .map(|(q, _)| BatchItem {
                vulns: self
                    .db
                    .get(&(q.name.clone(), q.version.clone()))
                    .into_iter()
                    .flatten()
                    .map(|id| Hit { id: id.clone(), modified: "2026-01-01T00:00:00Z".into() })
                    .collect(),
                next_page_token: None,
            })
            .collect())
    }

    async fn vuln(&self, id: &str) -> Result<Value, OsvError> {
        self.vuln_calls.fetch_add(1, Ordering::SeqCst);
        self.vulns.get(id).cloned().ok_or(OsvError::NotFound)
    }
}

fn rocky_osv() -> VersionedOsv {
    let mut api = VersionedOsv::default();
    api.add("kernel", OLD_K, "RLSA-OLD");
    api.add("kernel", OLD_K, "RLSA-BOTH");
    api.add("kernel", NEW_K, "RLSA-BOTH");
    api.add("kernel", ANCIENT_K, "RLSA-ANCIENT");
    api.add("curl", "7.76.1-26.el9", "RLSA-CURL");
    api.advisory("RLSA-OLD", "CVE-2026-1001", "kernel", NEW_K);
    api.advisory("RLSA-BOTH", "CVE-2026-1002", "kernel", "5.14.0-600.el9");
    api.advisory("RLSA-ANCIENT", "CVE-2026-1003", "kernel", OLD_K);
    api.advisory("RLSA-CURL", "CVE-2026-1004", "curl", "7.76.1-29.el9");
    api
}

fn rpm_line(name: &str, vr: &str, src: &str) -> String {
    let (v, r) = vr.split_once('-').unwrap();
    format!("{name}\t0\t{v}\t{r}\tx86_64\t{src}-{vr}.src.rpm\tRocky Enterprise Software Foundation\n")
}

/// Rocky 9 con tres kernels (en uso el del medio) y `curl` en la versión `curl_vr`.
fn rocky_input(uname: &str, curl_vr: &str) -> ScanInput {
    let detect = format!(
        "@@os\n{}\n@@kernel\nLinux {uname} x86_64\n@@id\nana\n1000\n@@container\nno\n@@pm\nrpm\n@@tools\n@@end\n",
        include_str!("fixtures/os-release-rockylinux.txt")
    );
    let pkgs: String = [ANCIENT_K, OLD_K, NEW_K].iter().map(|k| rpm_line("kernel-core", k, "kernel")).collect::<String>() + &rpm_line("curl", curl_vr, "curl");
    let inventory = format!("@@pm\nrpm\n@@pkgs\n{pkgs}@@tools\n@@home\n@@end\n");
    ScanInput {
        server_id: "srv-recheck".into(),
        detect: RawOutput { stdout: detect, ..Default::default() },
        inventory: RawOutput { stdout: inventory, ..Default::default() },
        use_osv: true,
        ..Default::default()
    }
}

fn no_progress() -> impl Fn(&str, usize, usize, &str) + Send + Sync {
    |_: &str, _: usize, _: usize, _: &str| {}
}

fn by_cve<'a>(r: &'a Report, cve: &str) -> Option<&'a Finding> {
    r.findings.iter().find(|f| f.id == cve)
}

#[tokio::test]
async fn old_kernels_do_not_count_and_running_one_only_needs_reboot() {
    let api = rocky_osv();
    let p = no_progress();
    let r = analyze(&rocky_input(&format!("{OLD_K}.x86_64"), "7.76.1-29.el9"), Some(&api), &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    // Sigue en el kernel nuevo: no se arregla reiniciando.
    let both = by_cve(&r, "CVE-2026-1002").expect("la del kernel nuevo");
    assert!(!both.needs_reboot);
    assert_eq!(both.installed, NEW_K);
    // Solo la tiene el kernel en uso: se arregla al reiniciar.
    let old = by_cve(&r, "CVE-2026-1001").expect("la del kernel en uso");
    assert!(old.needs_reboot && old.has_fix);
    assert_eq!(old.fixed.as_deref(), Some(NEW_K));
    // El kernel viejo que ni se usa no cuenta.
    assert!(by_cve(&r, "CVE-2026-1003").is_none());
    assert!(r.host.reboot_required);
    assert_eq!(r.host.reboot_kernel.as_deref(), Some(NEW_K));
    assert!(r.notes.iter().any(|n| n.text.contains("Kernels viejos")));

    // Después de reiniciar: ya no hay nada que se arregle reiniciando.
    let r = analyze(&rocky_input(&format!("{NEW_K}.x86_64"), "7.76.1-29.el9"), Some(&api), &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    assert!(by_cve(&r, "CVE-2026-1001").is_none());
    assert!(!r.host.reboot_required);
    assert!(r.findings.iter().all(|f| !f.needs_reboot));
}

#[tokio::test]
async fn recheck_drops_what_was_fixed_with_a_warm_cache() {
    let api = rocky_osv();
    let dir = std::env::temp_dir().join(format!("sshorus-recheck-{}", uuid::Uuid::new_v4()));
    let cache = OsvCache::at(dir.join("osv"));
    let history = History::at(dir.join("hist"));
    let p = no_progress();
    let uname = format!("{NEW_K}.x86_64");

    // Antes de arreglar: curl vulnerable. Y una imagen con lo suyo (no se toca al volver a comprobar).
    let mut base = analyze(&rocky_input(&uname, "7.76.1-26.el9"), Some(&api), &cache, &CancellationToken::new(), &p).await.unwrap();
    assert!(by_cve(&base, "CVE-2026-1004").is_some_and(|f| f.has_fix));
    let mut img = base.findings[0].clone();
    img.key = "CVE-2026-9999|zlib|image:podman::abc".into();
    img.id = "CVE-2026-9999".into();
    img.target = "image:podman::abc".into();
    base.findings.push(img);
    base.targets.push(Target {
        key: "image:podman::abc".into(),
        kind: TargetKind::Image,
        label: "Imagen x".into(),
        user: None,
        ecosystem: None,
        packages: 1,
        image: None,
        sources: vec![],
        error: None,
    });
    history.save(&base).unwrap();
    let calls = api.vuln_calls.load(Ordering::SeqCst);

    // Después de `dnf upgrade curl`: el inventario trae la versión nueva y OSV ya no la da por afectada.
    let partial = analyze(&rocky_input(&uname, "7.76.1-29.el9"), Some(&api), &cache, &CancellationToken::new(), &p).await.unwrap();
    assert_eq!(api.vuln_calls.load(Ordering::SeqCst), calls, "el detalle salió de la caché…");
    assert!(by_cve(&partial, "CVE-2026-1004").is_none(), "…pero lo arreglado no vuelve: la consulta usa la versión de ahora");
    assert!(partial.osv_sample.iter().any(|q| q.name == "curl" && q.version == "7.76.1-29.el9"));

    let merged = merge_system(&base, &partial);
    history.save(&merged).unwrap();
    assert_ne!(merged.id, base.id);
    assert!(by_cve(&merged, "CVE-2026-1004").is_none());
    assert!(by_cve(&merged, "CVE-2026-1002").is_some(), "lo que sigue, sigue");
    assert!(by_cve(&merged, "CVE-2026-9999").is_some(), "las imágenes se quedan como estaban");
    assert!(merged.targets.iter().any(|t| t.key == "image:podman::abc"));
    assert_eq!(merged.summary.total + merged.summary.unimportant, merged.findings.len() as u32);
    assert!(merged.summary.total < base.summary.total + 1);
    // Al volver a abrir la pestaña se lee el último del historial: ya sin lo arreglado.
    let latest = history.latest("srv-recheck").unwrap().unwrap();
    assert_eq!(latest.id, merged.id);
    assert!(by_cve(&latest, "CVE-2026-1004").is_none());
    let _ = std::fs::remove_dir_all(&dir);
}
