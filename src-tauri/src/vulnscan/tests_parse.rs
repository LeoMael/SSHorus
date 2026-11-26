//! Pruebas del escáner con salidas reales (`fixtures/`): secciones, os-release, paquetes y
//! herramientas de la distro. Las utilidades (`fx!`, `TempDir`…) están en `tests.rs`.

use super::*;

// ───────────── Secciones y utilidades ─────────────

#[test]
fn sections_split_by_marker() {
    let s = parse::sections("basura\n@@os\nID=x\n@@rc 3\n@@error no se pudo\n@@end\n");
    assert_eq!(s.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(), ["os", "rc", "error", "end"]);
    assert_eq!(parse::section(&s, "os").unwrap(), ["ID=x"]);
    assert_eq!(parse::section(&s, "rc").unwrap(), ["3"]);
    assert_eq!(parse::section(&s, "error").unwrap(), ["no se pudo"]);
}

#[test]
fn cve_helpers() {
    assert!(parse::is_cve("CVE-2024-12133"));
    assert!(parse::is_cve("CVE-2026-114406"));
    assert!(!parse::is_cve("CVE-24-1"));
    assert!(!parse::is_cve("DSA-5863-1"));
    assert_eq!(
        parse::find_cves("Fix (CVE-2026-8932), CVE-2026-13608 y CVE-2026-8932 otra vez; CVE-"),
        ["CVE-2026-8932", "CVE-2026-13608"]
    );
    assert_eq!(parse::short("  hola   mundo\n", 50), "hola mundo");
    assert_eq!(parse::short("abcdefghij", 5), "abcd…");
}

// ───────────── os-release → ecosistema ─────────────

#[test]
fn os_release_to_ecosystem() {
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-debian.txt"))).as_deref(), Some("Debian:12"));
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-ubuntu.txt"))).as_deref(), Some("Ubuntu:22.04:LTS"));
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-alpine.txt"))).as_deref(), Some("Alpine:v3.18"));
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-rockylinux.txt"))).as_deref(), Some("Rocky Linux:9"));
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-almalinux.txt"))).as_deref(), Some("AlmaLinux:9"));
    assert_eq!(ecosystem::for_os(&os(fx!("os-release-fedora.txt"))), None, "Fedora no está en OSV");
    // Ubuntu sin LTS, Leap y Tumbleweed (os-release de ejemplo).
    let u = os("ID=ubuntu\nVERSION_ID=\"23.10\"\nVERSION=\"23.10 (Mantic Minotaur)\"\n");
    assert_eq!(ecosystem::for_os(&u).as_deref(), Some("Ubuntu:23.10"));
    let leap = os("NAME=\"openSUSE Leap\"\nVERSION=\"15.6\"\nID=\"opensuse-leap\"\nID_LIKE=\"suse opensuse\"\nVERSION_ID=\"15.6\"\nPRETTY_NAME=\"openSUSE Leap 15.6\"\n");
    assert_eq!(ecosystem::for_os(&leap).as_deref(), Some("openSUSE:Leap 15.6"));
    assert_eq!(ecosystem::for_os(&os("ID=opensuse-tumbleweed\nVERSION_ID=\"20261101\"\n")).as_deref(), Some("openSUSE:Tumbleweed"));
    assert_eq!(ecosystem::for_os(&os("ID=arch\n")), None);
    // Ubuntu Pro (ESM) solo en LTS con Pro activado.
    let ubu = os(fx!("os-release-ubuntu.txt"));
    assert_eq!(ecosystem::ubuntu_pro(&ubu, true).as_deref(), Some("Ubuntu:Pro:22.04:LTS"));
    assert_eq!(ecosystem::ubuntu_pro(&ubu, false), None);
    assert_eq!(ecosystem::ubuntu_pro(&u, true), None);
    // Nombres para mostrar.
    assert_eq!(os(fx!("os-release-ubuntu.txt")).version_codename, "jammy");
    assert!(os(fx!("os-release-rockylinux.txt")).is_like("rhel"));
}

// ───────────── Paquetes ─────────────

#[test]
fn rpm_qa_rocky_source_and_no_epoch() {
    let pkgs = rpm::parse_qa(fx!("rpm-rockylinux.txt"));
    assert_eq!(pkgs.len(), 157);
    let ossl = &pkgs.iter().find(|(p, _)| p.name == "openssl-libs").unwrap().0;
    assert_eq!(ossl.source, "openssl");
    assert_eq!(ossl.version, "1:3.0.1-23.el9_0", "se muestra con epoch");
    assert_eq!(ossl.source_version, "3.0.1-23.el9_0", "a OSV va sin epoch");
    let lib = &pkgs.iter().find(|(p, _)| p.name == "libcurl").unwrap().0;
    assert_eq!(lib.source, "curl");
    assert_eq!(rpm::source_name("libssh-0.9.6-3.el9.src.rpm").as_deref(), Some("libssh"));
    assert_eq!(rpm::source_name("(none)"), None);
    assert_eq!(rpm::split_nevra("openssl-libs-1:3.5.9-1.fc44.x86_64"), Some(("openssl-libs".into(), "1:3.5.9-1.fc44".into())));
    assert_eq!(
        rpm::split_nevra("ca-certificates-2026.2.92_v9.0.319-90.3.el9_8.noarch"),
        Some(("ca-certificates".into(), "2026.2.92_v9.0.319-90.3.el9_8".into()))
    );
    assert_eq!(rpm::strip_epoch("0:7.76.1-14.el9_0.5"), "7.76.1-14.el9_0.5");
    // Con vendedor (7.ª columna).
    let v = rpm::parse_qa("docker-ce\t3\t27.0.0\t1.el9\tx86_64\tdocker-ce-27.0.0-1.el9.src.rpm\tDocker\n");
    assert_eq!(v[0].1.as_deref(), Some("Docker"));
    assert_eq!(v[0].0.version, "3:27.0.0-1.el9");
}

#[test]
fn rpm_qa_alma_and_fedora() {
    let alma = rpm::parse_qa(fx!("rpm-almalinux.txt"));
    assert!(alma.iter().any(|(p, _)| p.name == "curl-minimal" && p.source == "curl"));
    let fed = rpm::parse_qa(fx!("rpm-fedora.txt"));
    assert!(!fed.is_empty());
    assert!(fed.iter().all(|(p, _)| !p.source.is_empty() && !p.source_version.contains(':')));
}

#[test]
fn dpkg_query_debian_and_ubuntu() {
    let deb = dpkg::parse_query(fx!("dpkg-debian.txt"));
    assert_eq!(deb.len(), 88);
    let bsd = deb.iter().find(|p| p.name == "bsdutils").unwrap();
    assert_eq!((bsd.source.as_str(), bsd.source_version.as_str()), ("util-linux", "2.38.1-5"));
    assert_eq!(bsd.version, "1:2.38.1-5+b1");
    let z = deb.iter().find(|p| p.name == "zlib1g").unwrap();
    assert_eq!((z.source.as_str(), z.source_version.as_str()), ("zlib", "1:1.2.13.dfsg-1"));
    let ubu = dpkg::parse_query(fx!("dpkg-ubuntu.txt"));
    assert!(ubu.iter().any(|p| p.name == "libncursesw6" && p.source == "ncurses"));
    // Solo instalados («ii»), no «rc» (quitados con su configuración).
    assert!(dpkg::parse_query("rc \tviejo\t1.0\tviejo\t1.0\n").is_empty());
}

#[test]
fn dpkg_status_file() {
    let text = "Package: bsdutils\nStatus: install ok installed\nVersion: 1:2.38.1-5+b1\nSource: util-linux (2.38.1-5)\nArchitecture: amd64\n\n\
                Package: borrado\nStatus: deinstall ok config-files\nVersion: 1\n\n\
                Package: base-files\nVersion: 12.4\nArchitecture: amd64\nPackage: zlib1g\nVersion: 1:1.2.13.dfsg-1\nSource: zlib\n";
    let p = dpkg::parse_status(text);
    assert_eq!(p.len(), 3, "sin el borrado; status.d sin línea en blanco entre estrofas");
    assert_eq!((p[0].source.as_str(), p[0].source_version.as_str()), ("util-linux", "2.38.1-5"));
    assert_eq!(p[1].name, "base-files");
    assert_eq!((p[2].source.as_str(), p[2].source_version.as_str()), ("zlib", "1:1.2.13.dfsg-1"));
}

#[test]
fn apk_list_and_installed_db() {
    let l = apk::parse_list(fx!("apk-list-alpine.txt"));
    assert_eq!(l.len(), 15);
    let c = l.iter().find(|p| p.name == "libcrypto3").unwrap();
    assert_eq!((c.source.as_str(), c.version.as_str()), ("openssl", "3.1.0-r4"));
    let origins: std::collections::BTreeSet<_> = l.iter().map(|p| p.source.clone()).collect();
    assert_eq!(origins.len(), 10, "10 orígenes, como en 10.13");
    let db = apk::parse_installed(fx!("apk-installed-alpine.txt"));
    assert_eq!(db.len(), 15);
    assert!(db.iter().any(|p| p.name == "libssl3" && p.source == "openssl" && p.version == "3.1.0-r4"));
    let sshd = apk::parse_list(fx!("apk-list-terview-sshd.txt"));
    assert_eq!(sshd.iter().map(|p| p.source.clone()).collect::<std::collections::BTreeSet<_>>().len(), 46);
    assert_eq!(apk::split_name_version("sudo-1.9.17_p2-r2"), Some(("sudo".into(), "1.9.17_p2-r2".into())));
    assert_eq!(apk::split_name_version("py3-a-1-0.2-r0"), Some(("py3-a-1".into(), "0.2-r0".into())));
}

// ───────────── Herramientas de la distro ─────────────

#[test]
fn dnf4_rocky_list_and_info() {
    let info = dnf::parse_info4(fx!("dnf4-updateinfo-info-rocky.txt"));
    let curl = info.iter().find(|a| a.id == "RLSA-2022:6157").unwrap();
    assert_eq!(curl.cves, ["CVE-2022-32206", "CVE-2022-32207", "CVE-2022-32208"]);
    assert_eq!(curl.severity.as_deref(), Some("Moderate"));
    assert_eq!(curl.title.as_deref(), Some("Moderate: curl security update"));
    let acl = info.iter().find(|a| a.id == "RLSA-2026:42736").unwrap();
    assert_eq!(acl.cve_text.get("CVE-2026-54369").map(String::as_str), Some("acl: Symlink traversal privilege escalation via libacl functions"));

    let f = dnf::findings4(fx!("dnf4-updateinfo-list-rocky.txt"), fx!("dnf4-updateinfo-info-rocky.txt"));
    let c = f.iter().find(|x| x.advisory.as_deref() == Some("RLSA-2022:6157") && x.cves == ["CVE-2022-32206"]).unwrap();
    assert_eq!(c.package, "curl");
    assert_eq!(c.fixed.as_deref(), Some("7.76.1-14.el9_0.5"));
    assert!(c.has_fix);
    let ca = f.iter().find(|x| x.cves == ["CVE-2026-114406"]).unwrap();
    assert_eq!(ca.severity.as_deref(), Some("Critical"));
    assert_eq!(ca.package, "ca-certificates");
    // dbus lleva epoch en el NEVRA.
    assert!(f.iter().any(|x| x.package == "dbus" && x.fixed.as_deref() == Some("1:1.12.20-7.el9_1")));
    assert!(dnf::parse_list4(fx!("dnf4-updateinfo-list-rocky.txt")).len() > 250);
}

#[test]
fn dnf5_fedora_json() {
    let f = dnf::findings5(fx!("dnf5-advisory-list-fedora44.json"), fx!("dnf5-advisory-info-fedora44.json"));
    // curl: 3 CVE sacados de las referencias de Bugzilla, para curl y libcurl.
    let curl: Vec<_> = f.iter().filter(|x| x.advisory.as_deref() == Some("FEDORA-2026-a06b828d65")).collect();
    assert_eq!(curl.len(), 6);
    let c = curl.iter().find(|x| x.package == "curl" && x.cves == ["CVE-2026-8932"]).unwrap();
    assert_eq!(c.severity.as_deref(), Some("Moderate"));
    assert_eq!(c.summary.as_deref(), Some("curl: libcurl: Security feature bypass due to improper mTLS connection reuse"));
    assert_eq!(c.fixed.as_deref(), Some("8.18.0-14.fc44"));
    // openssl: sin CVE → fila con el aviso.
    let o = f.iter().find(|x| x.advisory.as_deref() == Some("FEDORA-2026-12f3f3d569")).unwrap();
    assert!(o.cves.is_empty());
    assert_eq!(o.package, "openssl-libs");
    assert_eq!(o.severity.as_deref(), Some("Important"));
    // sudo: el CVE sale de la descripción.
    assert!(f.iter().any(|x| x.package == "sudo" && x.cves == ["CVE-2026-96512"]));
    assert!(dnf::findings5("[]", "[]").is_empty());
    assert!(dnf::findings5("no es json", "").is_empty());
}

#[test]
fn debsecan_detail_debian12() {
    let f = debsecan::parse_detail(fx!("debsecan-detail-debian12.txt"));
    assert_eq!(f.len(), 435, "un bloque por CVE y binario");
    let unique: std::collections::BTreeSet<_> = f.iter().map(|x| x.cves[0].clone()).collect();
    assert!(unique.len() >= 200);
    let wall = f.iter().find(|x| x.cves == ["CVE-2024-28085"] && x.package == "bsdutils").unwrap();
    assert_eq!(wall.source.as_deref(), Some("util-linux"));
    assert_eq!(wall.installed.as_deref(), Some("1:2.38.1-5+b1"));
    assert!(wall.has_fix);
    assert!(wall.summary.as_deref().unwrap().starts_with("wall in util-linux"));
    assert!(f.iter().any(|x| x.severity.as_deref() == Some("low")), "«(low urgency)»");
    let sin = f.iter().find(|x| x.cves == ["CVE-2026-13595"]).unwrap();
    assert!(!sin.has_fix);
}

#[test]
fn ubuntu_pro_api() {
    let f = ubuntu_pro::parse(fx!("pro-api-cves-ubuntu22.json")).unwrap();
    assert_eq!(f.len(), 247);
    let c = f.iter().find(|x| x.package == "coreutils" && x.cves == ["CVE-2016-2781"]).unwrap();
    assert_eq!(c.severity.as_deref(), Some("low"));
    assert_eq!(c.cvss, Some(6.5));
    assert!(!c.has_fix);
    assert_eq!(c.status.as_deref(), Some("vulnerable"));
    let fail = r#"{"_schema_version":"v1","data":{"meta":{}},"errors":[{"code":"api-invalid-endpoint"}],"result":"failure"}"#;
    assert!(ubuntu_pro::parse(fail).is_err());
    assert!(ubuntu_pro::parse("basura").is_err());
}

#[test]
fn zypper_xml() {
    assert!(zypper::parse(fx!("zypper-leap156-vacio.xml")).is_empty());
    // Formato de zypper con parches pendientes (ejemplo hecho a mano: no se pudo capturar uno real).
    let xml = r#"<?xml version='1.0'?><stream><update-status version="0.6"><update-list>
<update kind="patch" name="openSUSE-SLE-15.6-2024-1234" edition="1" arch="noarch" status="needed" category="security" severity="important" pkgmanager="false" restart="false" interactive="false">
<summary>Security update for curl</summary><description>Fixes &lt;bugs&gt;</description>
<issue-list><issue type="bugzilla" id="1234"/><issue type="cve" id="CVE-2024-6197"/><issue type="cve" id="CVE-2024-6874"/></issue-list>
</update>
<update kind="patch" name="openSUSE-2024-9" status="needed" category="recommended" severity="low"><summary>Bugfix</summary></update>
</update-list></update-status></stream>"#;
    let f = zypper::parse(xml);
    assert_eq!(f.len(), 2);
    assert_eq!(f[0].package, "curl");
    assert_eq!(f[0].cves, ["CVE-2024-6197"]);
    assert_eq!(f[1].cves, ["CVE-2024-6874"]);
    assert_eq!(f[0].severity.as_deref(), Some("important"));
    assert_eq!(f[0].advisory.as_deref(), Some("openSUSE-SLE-15.6-2024-1234"));
}

#[test]
fn trivy_template_rocky() {
    let f = trivy::parse(fx!("trivy-rootfs-rocky90.tsv"));
    assert_eq!(f.len(), 592, "592 hallazgos, como en 10.13");
    let acl = &f[0];
    assert_eq!((acl.class.as_str(), acl.id.as_str(), acl.package.as_str()), ("os-pkgs", "CVE-2026-54369", "acl"));
    assert_eq!(acl.fixed.as_deref(), Some("2.4.0-1.el9_8"));
    assert_eq!(acl.severity, "HIGH");
    assert_eq!(acl.status.as_deref(), Some("fixed"));
    assert_eq!(acl.path, None);
    assert!(f.iter().any(|x| x.severity == "CRITICAL"));
    assert_eq!(trivy::version("Version: 0.76.2").as_deref(), Some("0.76.2"));
    // La plantilla es la que produjo ese archivo.
    assert!(scripts::TRIVY_TEMPLATE.contains("{{ $c }}\t{{ .VulnerabilityID }}\t{{ .PkgName }}"));
}
