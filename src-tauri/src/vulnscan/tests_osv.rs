//! Pruebas del escáner: avisos reales de OSV y la OSV falsa de `tests.rs` (lotes, páginas,
//! ecosistemas inválidos y caché).

use super::*;

#[test]
fn osv_vuln_fields() {
    let dsa = vuln("DSA-5863-1");
    assert_eq!(dsa.cves(), ["CVE-2024-12133"]);
    assert_eq!(dsa.fixed_for("Debian:12", "libtasn1-6", "4.19.0-2").as_deref(), Some("4.19.0-2+deb12u1"));
    assert!(ecosystem::is_advisory(&dsa.id));

    let z = vuln("DEBIAN-CVE-2023-45853");
    assert_eq!(z.cves(), ["CVE-2023-45853"]);
    assert_eq!(z.fixed_for("Debian:12", "zlib", "1:1.2.13.dfsg-1"), None, "zlib sin arreglo");
    assert_eq!(z.fixed_for("Debian:12", "minizip", "1.1-8").as_deref(), Some("1.1-8+deb12u1"));
    assert_eq!(z.distro_severity("Debian:12", "zlib").as_deref(), Some("not yet assigned"));
    assert_eq!(z.cvss("Debian:12", "zlib").map(|c| c.0), Some(9.8));

    let r = vuln("RLSA-2022:6157");
    assert_eq!(r.cves(), ["CVE-2022-32206", "CVE-2022-32207", "CVE-2022-32208"]);
    assert_eq!(r.fixed_for("Rocky Linux:9", "curl", "7.76.1-14.el9_0.4").as_deref(), Some("7.76.1-14.el9_0.5"), "sin «0:»");
    assert_eq!(r.distro_severity("Rocky Linux:9", "curl").as_deref(), Some("Moderate"));
    assert_eq!(r.cvss("Rocky Linux:9", "curl").map(|c| c.0), Some(9.8));

    let u = vuln("UBUNTU-CVE-2023-50495");
    assert_eq!(u.distro_severity("Ubuntu:22.04:LTS", "ncurses").as_deref(), Some("low"));
    assert!(u.related.iter().any(|x| x.starts_with("USN-")));

    let a = vuln("ALPINE-CVE-2023-2650");
    assert_eq!(a.cves(), ["CVE-2023-2650"]);
    assert!(a.title().unwrap().len() > 10, "sin summary: se usa el principio de details");

    let al = vuln("ALSA-2023:0333");
    assert_eq!(al.cves(), ["CVE-2022-32221"]);
    // Un CVE puro de OSV: sus «related» son avisos, no otros CVE.
    assert_eq!(vuln("CVE-2023-2650").cves(), ["CVE-2023-2650"]);
}

#[test]
fn version_compare() {
    use std::cmp::Ordering::*;
    assert_eq!(osv::cmp_versions("1.2.10", "1.2.9"), Greater);
    assert_eq!(osv::cmp_versions("4.19.0-2+deb12u1", "4.19.0-2"), Greater);
    assert_eq!(osv::cmp_versions("1.0~rc1", "1.0"), Less);
    assert_eq!(osv::cmp_versions("0:7.76.1-14.el9_0.5", "7.76.1-14.el9_0.4"), Greater);
    assert_eq!(osv::cmp_versions("3.1.1u-r0", "3.1.0-r4"), Greater);
    assert_eq!(osv::cmp_versions("18.16.1", "18.16.1"), Equal);
}

#[tokio::test]
async fn osv_batches_of_1000_and_pagination() {
    let mut api = FakeOsv { page: 2, ..Default::default() };
    api.db.insert(("Debian:12".into(), "p5".into()), (0..5).map(|i| format!("V{i}")).collect());
    let queries: Vec<Query> = (0..2500).map(|i| q("Debian:12", &format!("p{i}"))).collect();
    let out = osv::query_all(&api, &queries, &CancellationToken::new()).await.unwrap();
    // 3 lotes (1000+1000+500) y luego 2 rondas solo con la consulta paginada.
    assert_eq!(*api.batch_sizes.lock().unwrap(), [1000, 1000, 500, 1, 1]);
    assert_eq!(out.hits[5].iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["V0", "V1", "V2", "V3", "V4"]);
    assert!(out.hits[6].is_empty());
    assert!(out.rejected.is_empty());
}

#[tokio::test]
async fn osv_invalid_ecosystem_does_not_sink_the_rest() {
    let mut api = FakeOsv { bad_ecosystems: vec!["Fedora:41".into()], ..Default::default() };
    api.db.insert(("Alpine:v3.18".into(), "openssl".into()), vec!["ALPINE-CVE-2023-2650".into()]);
    let queries = vec![q("Fedora:41", "curl"), q("Alpine:v3.18", "openssl"), q("Alpine:v3.18", "musl")];
    let out = osv::query_all(&api, &queries, &CancellationToken::new()).await.unwrap();
    assert_eq!(out.hits[1][0].id, "ALPINE-CVE-2023-2650");
    assert!(out.rejected.contains("Fedora:41"));
    assert_eq!(api.batch_calls.load(Ordering::SeqCst), 3, "el lote + uno por ecosistema");
}

#[tokio::test]
async fn osv_details_use_the_cache() {
    let dir = TempDir::new();
    let cache = OsvCache::at(dir.0.join("osv"));
    let mut api = FakeOsv::default();
    api.vulns.insert("DSA-5863-1".into(), serde_json::from_str(fx!("osv/DSA-5863-1.json")).unwrap());
    let ids = vec![("DSA-5863-1".to_string(), "2026-01-01T00:00:00Z".to_string()), ("NO-EXISTE".to_string(), String::new())];
    let cancel = CancellationToken::new();
    let (d, failed) = osv::fetch_details(&api, &cache, &ids, &cancel, &|_, _| {}).await.unwrap();
    assert!(d.contains_key("DSA-5863-1"));
    assert_eq!(failed, 1);
    assert_eq!(api.vuln_calls.load(Ordering::SeqCst), 2);
    // Segunda vez: el DSA sale de la caché (su `modified` real coincide con el guardado).
    let real_mod = d["DSA-5863-1"].modified.clone().unwrap();
    let ids2 = vec![("DSA-5863-1".to_string(), real_mod)];
    osv::fetch_details(&api, &cache, &ids2, &cancel, &|_, _| {}).await.unwrap();
    assert_eq!(api.vuln_calls.load(Ordering::SeqCst), 2, "no se volvió a pedir");
    // Si OSV dice otra fecha, se pide de nuevo.
    let ids3 = vec![("DSA-5863-1".to_string(), "2099-01-01T00:00:00Z".to_string())];
    osv::fetch_details(&api, &cache, &ids3, &cancel, &|_, _| {}).await.unwrap();
    assert_eq!(api.vuln_calls.load(Ordering::SeqCst), 3);
    assert!(OsvCache::none().get("DSA-5863-1", None).is_none());
}
