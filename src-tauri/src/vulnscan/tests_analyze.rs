//! Pruebas del escáner: análisis completo con la OSV falsa, historial, exportar y «Actualizar imagen».

use super::*;

// ───────────── Análisis completo con OSV falsa ─────────────

fn raw(stdout: impl Into<String>) -> RawOutput {
    RawOutput { stdout: stdout.into(), ..Default::default() }
}

fn debian_input() -> ScanInput {
    let detect = format!(
        "@@os\n{}\n@@kernel\nLinux 6.1.0 x86_64\n@@id\nana\n1000\n@@container\nyes\n@@pm\ndpkg\n@@tools\ndebsecan\t/usr/bin/debsecan\n@@end\n",
        fx!("os-release-debian.txt")
    );
    let inventory = format!(
        "@@pm\ndpkg\n@@pkgs\n{}@@tools\nnode\t/home/ana/.nvm/versions/node/v18.0.0/bin/node\t\t\tv18.0.0\n\
         nginx\t/usr/sbin/nginx\tnginx\tNGINX Packaging <nginx-packaging@f5.com>\tnginx version: nginx/1.20.0\n@@home\n@@end\n",
        fx!("dpkg-debian.txt")
    );
    let debsecan = "@@debsecan\nCVE-2024-12133 (fixed, high urgency)\n  A flaw in libtasn1 ...\n  installed: libtasn1-6 4.19.0-2\n             (built from libtasn1-6 4.19.0-2)\n  fix is available for the selected suite (bookworm)\n\n@@rc 0\n@@end\n";
    ScanInput {
        server_id: "srv-prueba".into(),
        detect: raw(detect),
        inventory: raw(inventory),
        distro_tool: Some(DistroTool::Debsecan),
        distro_output: Some(raw(debsecan)),
        images: vec![],
        elevated: false,
        use_osv: true,
        notes: vec![],
        server_ms: 10,
    }
}

fn debian_osv() -> FakeOsv {
    let mut api = FakeOsv::default();
    api.db.insert(("Debian:12".into(), "libtasn1-6".into()), vec!["DSA-5863-1".into(), "DEBIAN-CVE-2024-12133".into()]);
    api.db.insert(("Debian:12".into(), "zlib".into()), vec!["DEBIAN-CVE-2023-45853".into()]);
    api.db.insert(("Bitnami".into(), "node".into()), vec!["BIT-node-2023-30581".into()]);
    api.vulns.insert("DSA-5863-1".into(), serde_json::from_str(fx!("osv/DSA-5863-1.json")).unwrap());
    api.vulns.insert(
        "DEBIAN-CVE-2024-12133".into(),
        json!({"id":"DEBIAN-CVE-2024-12133","modified":"2026-01-01T00:00:00Z","upstream":["CVE-2024-12133"],
               "details":"Potential DoS in libtasn1","severity":[{"type":"CVSS_V3","score":"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"}],
               "affected":[{"package":{"ecosystem":"Debian:12","name":"libtasn1-6"},"ranges":[{"type":"ECOSYSTEM","events":[{"introduced":"0"},{"fixed":"4.19.0-2+deb12u1"}]}],
               "ecosystem_specific":{"urgency":"low"}}]}),
    );
    let mut z: Value = serde_json::from_str(fx!("osv/DEBIAN-CVE-2023-45853.json")).unwrap();
    z["affected"][1]["ecosystem_specific"]["urgency"] = json!("unimportant");
    api.vulns.insert("DEBIAN-CVE-2023-45853".into(), z);
    api.vulns.insert(
        "BIT-node-2023-30581".into(),
        json!({"id":"BIT-node-2023-30581","modified":"2026-01-01T00:00:00Z","aliases":["CVE-2023-30581"],"summary":"policy bypass",
               "database_specific":{"severity":"High"},
               "affected":[{"package":{"ecosystem":"Bitnami","name":"node"},"ranges":[{"type":"SEMVER","events":[{"introduced":"16.0.0"},{"fixed":"16.20.1"},{"introduced":"18.0.0"},{"fixed":"18.16.1"},{"introduced":"20.0.0"},{"fixed":"20.3.1"}]}]}]}),
    );
    api
}

#[tokio::test]
async fn analyze_merges_sources_by_cve() {
    let api = debian_osv();
    let dir = TempDir::new();
    let cache = OsvCache::at(dir.0.join("osv"));
    let p = no_progress();
    let r = analyze(&debian_input(), Some(&api), &cache, &CancellationToken::new(), &p).await.unwrap();

    // DSA-5863-1 + DEBIAN-CVE-2024-12133 + debsecan → una sola fila por CVE.
    let tasn: Vec<_> = r.findings.iter().filter(|f| f.package == "libtasn1-6").collect();
    assert_eq!(tasn.len(), 1, "{tasn:#?}");
    let t = tasn[0];
    assert_eq!(t.id, "CVE-2024-12133");
    assert_eq!(t.advisories, ["DSA-5863-1"]);
    assert!(t.aliases.contains(&"DEBIAN-CVE-2024-12133".to_string()));
    assert_eq!(t.sources, [SourceId::Osv, SourceId::Distro]);
    assert_eq!(t.fixed.as_deref(), Some("4.19.0-2+deb12u1"));
    assert!(t.has_fix);
    assert_eq!(t.severity, Severity::High, "la urgencia más alta de la distro (debsecan: high)");
    assert_eq!(t.binaries, ["libtasn1-6"]);
    assert_eq!(t.target, "system");

    // zlib «unimportant»: oculta y fuera de los totales.
    let z = r.findings.iter().find(|f| f.id == "CVE-2023-45853" && f.package == "zlib").unwrap();
    assert!(z.unimportant);
    assert!(!z.has_fix);
    assert_eq!(z.binaries, ["zlib1g"]);
    assert_eq!(r.summary.unimportant, 1);

    // Node suelto en $HOME → Bitnami, con la versión que arregla su rama.
    let n = r.findings.iter().find(|f| f.package == "node").unwrap();
    assert_eq!((n.id.as_str(), n.target.as_str()), ("CVE-2023-30581", "runtime"));
    assert_eq!(n.fixed.as_deref(), Some("18.16.1"));
    assert!(n.upstream);
    assert_eq!(n.severity, Severity::High);
    // nginx de nginx.org (terceros) → también suelto; y su paquete no se consulta como de Debian.
    assert!(r.osv_sample.iter().any(|s| s.ecosystem == "Bitnami" && s.name == "nginx" && s.version == "1.20.0"));
    assert!(r.programs.iter().any(|p| p.name == "nginx" && p.third_party));

    // Lo que viajó a OSV: solo ecosistema, nombre y versión; fuente en Debian.
    assert!(r.osv_sample.iter().any(|s| s.ecosystem == "Debian:12" && s.name == "util-linux" && s.version == "2.38.1-5"));
    assert!(!r.osv_sample.iter().any(|s| s.name == "bsdutils"));
    assert!(r.sources.iter().all(|s| s.used || s.id == SourceId::Trivy));
    assert_eq!(r.summary.total, r.findings.iter().filter(|f| !f.unimportant).count() as u32);
    assert!(r.notes.iter().any(|n| n.text.contains("contenedor")));
    assert!(r.notes.iter().any(|n| n.text.contains("Sin sudo")));
    assert_eq!(r.host.ecosystem.as_deref(), Some("Debian:12"));
}

#[tokio::test]
async fn analyze_without_osv_and_with_images() {
    let mut input = debian_input();
    input.use_osv = false;
    input.elevated = true;
    let listing = "@@images\ndd89c878aa26\tdocker.io/library/rockylinux:9.0\n@@containers\nc1c1c1c1c1c1\tapp\tdd89c878aa26ffff\trunning\n@@end\n";
    let trivy = format!("@@os\n{}\n@@trivyver\nVersion: 0.76.2\n@@trivy\n{}@@rc 0\n@@end\n", fx!("os-release-rockylinux.txt"), fx!("trivy-rootfs-rocky90.tsv"));
    input.images = vec![
        ImageRaw { engine: Some(Engine::Podman), user: Some("ana".into()), listing: Some(listing.into()), ..Default::default() },
        ImageRaw {
            engine: Some(Engine::Podman),
            user: Some("ana".into()),
            image_id: "dd89c878aa26".into(),
            output: Some(raw(trivy)),
            ..Default::default()
        },
    ];
    let p = no_progress();
    let r = analyze::<FakeOsv>(&input, None, &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    let img = r.targets.iter().find(|t| t.kind == TargetKind::Image).unwrap();
    assert_eq!(img.key, "image:podman:ana:dd89c878aa26");
    let info = img.image.as_ref().unwrap();
    assert_eq!(info.tags, ["docker.io/library/rockylinux:9.0"]);
    assert_eq!(info.containers[0].name, "app");
    assert_eq!(info.method.as_deref(), Some("Trivy 0.76.2"));
    let n = r.findings.iter().filter(|f| f.target == img.key).count();
    assert!(n > 500, "{n}");
    let acl = r.findings.iter().find(|f| f.target == img.key && f.id == "CVE-2026-54369").unwrap();
    assert_eq!(acl.severity, Severity::High);
    assert_eq!(acl.sources, [SourceId::Trivy]);
    let osv = r.sources.iter().find(|s| s.id == SourceId::Osv).unwrap();
    assert!(!osv.used);
    assert_eq!(osv.note.as_deref(), Some("desactivado en Ajustes"));
    assert!(r.sources.iter().find(|s| s.id == SourceId::Trivy).unwrap().used);
    // Solo debsecan para el sistema.
    assert!(r.findings.iter().any(|f| f.target == "system" && f.sources == [SourceId::Distro]));
}

#[tokio::test]
async fn analyze_fedora_tool_only() {
    let detect = format!("@@os\n{}\n@@pm\nrpm\n@@tools\ndnf\t/usr/bin/dnf\n@@dnf\ndnf5 version 5.2.17.0\n@@end\n", fx!("os-release-fedora.txt"));
    let inv = format!("@@pm\nrpm\n@@pkgs\n{}@@tools\n@@home\n@@end\n", fx!("rpm-fedora.txt"));
    let tool = format!(
        "@@list\n{}\n@@rc 0\n@@info\n{}\n@@rc 0\n@@end\n",
        fx!("dnf5-advisory-list-fedora44.json"),
        fx!("dnf5-advisory-info-fedora44.json")
    );
    let input = ScanInput {
        server_id: "fed".into(),
        detect: raw(detect),
        inventory: raw(inv),
        distro_tool: Some(DistroTool::Dnf5),
        distro_output: Some(raw(tool)),
        use_osv: true,
        ..Default::default()
    };
    let api = FakeOsv::default();
    let p = no_progress();
    let r = analyze(&input, Some(&api), &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    assert_eq!(api.batch_calls.load(Ordering::SeqCst), 0, "Fedora no va a OSV");
    assert!(r.notes.iter().any(|n| n.text.contains("Fedora no está en OSV")));
    // curl y libcurl → un hallazgo por CVE en el paquete fuente curl.
    let c = r.findings.iter().find(|f| f.id == "CVE-2026-8932").unwrap();
    assert_eq!(c.package, "curl");
    assert_eq!(c.binaries.len(), 2);
    assert_eq!(c.advisories, ["FEDORA-2026-a06b828d65"]);
    assert_eq!(c.severity, Severity::Medium);
    let o = r.findings.iter().find(|f| f.id == "FEDORA-2026-12f3f3d569").unwrap();
    assert_eq!((o.package.as_str(), o.severity), ("openssl", Severity::High));
    assert_eq!(r.summary.total as usize, r.findings.len());
    assert_eq!(r.summary.with_fix, r.summary.total);
}

#[tokio::test]
async fn analyze_can_be_canceled() {
    let api = debian_osv();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let p = no_progress();
    let r = analyze(&debian_input(), Some(&api), &OsvCache::none(), &cancel, &p).await;
    assert!(matches!(r, Err(crate::error::AppError::Canceled)));
}

// ───────────── Historial y exportar ─────────────

async fn sample_report() -> Report {
    let api = debian_osv();
    let p = no_progress();
    analyze(&debian_input(), Some(&api), &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap()
}

#[tokio::test]
async fn history_keeps_20_and_ai() {
    let dir = TempDir::new();
    let h = History::at(&dir.0);
    let base = sample_report().await;
    let mut last = String::new();
    for i in 0..23 {
        let mut r = base.clone();
        r.id = format!("r{i}");
        h.save(&r).unwrap();
        last = r.id;
    }
    let list = h.list("srv-prueba").unwrap();
    assert_eq!(list.len(), 20);
    assert_eq!(list[0].id, last);
    assert_eq!(h.latest("srv-prueba").unwrap().unwrap().id, last);
    assert!(h.get("srv-prueba", "r0").is_err(), "el más viejo se fue");
    let ai = AiExplanation { model: "m".into(), created_at: "2026-11-12T00:00:00Z".into(), text: "hola".into() };
    let r = h.set_ai("srv-prueba", "r10", Some(ai.clone())).unwrap();
    assert_eq!(r.ai, Some(ai));
    assert!(h.list("srv-prueba").unwrap().iter().any(|m| m.id == "r10" && m.has_ai));
    h.delete("srv-prueba", Some("r10")).unwrap();
    assert_eq!(h.list("srv-prueba").unwrap().len(), 19);
    h.delete("srv-prueba", None).unwrap();
    assert!(h.list("srv-prueba").unwrap().is_empty());
    assert!(h.latest("../etc/passwd").is_err(), "ids raros no valen");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        h.save(&base).unwrap();
        let mode = std::fs::metadata(dir.0.join("srv-prueba.json")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[tokio::test]
async fn export_markdown_and_json() {
    let r = sample_report().await;
    let md = export::to_markdown(&r, Some("Mi servidor"));
    assert!(md.starts_with("# Vulnerabilidades de Mi servidor"));
    assert!(md.contains("| Crítica | Alta |"));
    assert!(md.contains("CVE-2024-12133"));
    assert!(md.contains("sin importancia"), "{md}");
    let anon = export::to_markdown(&r, None);
    assert!(anon.starts_with("# Vulnerabilidades de servidor-1"));
    let j = export::to_json(&r, true);
    let back: Report = serde_json::from_str(&j).unwrap();
    assert_eq!(back.server_id, "servidor-1");
    assert_eq!(back.findings.len(), r.findings.len());
}

// ───────────── Volver a analizar una imagen («Actualizar imagen») ─────────────

#[tokio::test]
async fn rescan_replaces_only_that_image() {
    let mut input = debian_input();
    input.use_osv = false;
    input.elevated = true;
    let listing = "@@images\ndd89c878aa26\tdocker.io/library/rockylinux:9.0\n@@containers\nc1c1c1c1c1c1\tapp\tdd89c878aa26ffff\trunning\n@@end\n";
    let trivy = format!("@@os\n{}\n@@trivyver\nVersion: 0.76.2\n@@trivy\n{}@@rc 0\n@@end\n", fx!("os-release-rockylinux.txt"), fx!("trivy-rootfs-rocky90.tsv"));
    input.images = vec![
        ImageRaw { engine: Some(Engine::Podman), user: Some("ana".into()), listing: Some(listing.into()), ..Default::default() },
        ImageRaw { engine: Some(Engine::Podman), user: Some("ana".into()), image_id: "dd89c878aa26".into(), output: Some(raw(trivy)), ..Default::default() },
    ];
    let p = no_progress();
    let base = analyze::<FakeOsv>(&input, None, &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    let old_key = "image:podman:ana:dd89c878aa26";
    let system = base.findings.iter().filter(|f| f.target == "system").count();
    assert!(base.findings.iter().any(|f| f.target == old_key));

    // La imagen nueva (otro id, misma etiqueta) ya no tiene nada.
    let listing = "@@images\neeeeeeeeeeee\tdocker.io/library/rockylinux:9.0\n@@containers\nc2c2c2c2c2c2\tapp\teeeeeeeeeeeeffff\trunning\n@@end\n";
    let out = format!("@@os\n{}\n@@trivyver\nVersion: 0.76.2\n@@trivy\n@@rc 0\n@@end\n", fx!("os-release-rockylinux.txt"));
    let partial_input = ScanInput {
        server_id: base.server_id.clone(),
        images: vec![
            ImageRaw { engine: Some(Engine::Podman), user: Some("ana".into()), listing: Some(listing.into()), ..Default::default() },
            ImageRaw { engine: Some(Engine::Podman), user: Some("ana".into()), image_id: "eeeeeeeeeeee".into(), output: Some(raw(out)), ..Default::default() },
        ],
        elevated: true,
        ..Default::default()
    };
    let partial = analyze::<FakeOsv>(&partial_input, None, &OsvCache::none(), &CancellationToken::new(), &p).await.unwrap();
    let m = crate::vulnscan::analyze::merge_rescan(&base, old_key, &partial);
    assert_ne!(m.id, base.id);
    assert!(m.targets.iter().all(|t| t.key != old_key), "la imagen vieja se quita");
    let t = m.targets.iter().find(|t| t.key == "image:podman:ana:eeeeeeeeeeee").unwrap();
    assert_eq!(t.image.as_ref().unwrap().containers[0].name, "app");
    assert!(m.findings.iter().all(|f| f.target != old_key));
    assert_eq!(m.findings.iter().filter(|f| f.target == "system").count(), system, "el sistema no cambia");
    assert!(m.targets.iter().any(|t| t.key == "system"));
    assert_eq!(m.summary.total + m.summary.unimportant, m.findings.len() as u32);
    assert!(m.summary.total < base.summary.total);
    assert!(m.notes.iter().any(|n| n.text.contains("Actualizar imagen")));
    // Solo los avisos de imágenes del análisis parcial (no «detección incompleta», etc.).
    assert!(!m.notes.iter().any(|n| n.text.contains("detección")));
}
