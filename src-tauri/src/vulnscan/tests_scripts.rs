//! Pruebas del escáner: scripts propios (válidos y ejecutados en local), programas sueltos y
//! gravedad.

use super::*;

// ───────────── Scripts propios ─────────────

#[test]
fn inventory_prototype_sshorus_sshd() {
    // Salida del prototipo del script de inventario contra el servidor de pruebas (4 columnas en @@tools).
    let inv = inventory::parse_inventory(fx!("inventario-terview-sshd.txt"));
    assert!(inv.complete);
    assert_eq!(inv.pm, Some(PackageManager::Apk));
    assert_eq!(inv.packages.iter().map(|p| p.source.clone()).collect::<std::collections::BTreeSet<_>>().len(), 46);
    let sudo = inv.programs.iter().find(|p| p.name == "sudo").unwrap();
    assert_eq!(sudo.owner.as_deref(), Some("sudo"));
    assert_eq!(sudo.version_line, "Sudo version 1.9.17p2");
    let d = inventory::parse_detect(fx!("inventario-terview-sshd.txt"));
    assert_eq!(d.os.id, "alpine");
    assert_eq!(d.kernel, "7.2.15-300.fc45.x86_64");
    assert_eq!(ecosystem::for_os(&d.os).as_deref(), Some("Alpine:v3.24"));
}

#[test]
fn detect_and_plan() {
    let out = "@@os\nID=rocky\nID_LIKE=\"rhel centos fedora\"\nVERSION_ID=\"9.0\"\nPRETTY_NAME=\"Rocky Linux 9.0\"\n\
               @@kernel\nLinux 5.14.0 x86_64\n@@id\nana\n1000\n@@container\nno\n@@pm\nrpm\n\
               @@tools\ndnf\t/usr/bin/dnf\npodman\t/usr/bin/podman\ntrivy\t/usr/bin/trivy\n\
               @@dnf\n4.14.0\n@@trivy\nVersion: 0.76.2\n@@pro\n@@docker\nno\n@@end\n";
    let p = plan_from(out);
    assert_eq!(p.distro_tool, Some(DistroTool::Dnf4));
    assert_eq!(p.ecosystem.as_deref(), Some("Rocky Linux:9"));
    assert_eq!(p.trivy.as_deref(), Some("0.76.2"));
    assert!(p.podman && !p.docker && !p.is_root && p.complete);
    let fed = out.replace("ID=rocky", "ID=fedora").replace("4.14.0", "dnf5 version 5.2.17.0");
    assert_eq!(plan_from(&fed).distro_tool, Some(DistroTool::Dnf5));
    let deb = "@@os\nID=debian\nVERSION_ID=\"12\"\nVERSION_CODENAME=bookworm\n@@tools\ndebsecan\t/usr/bin/debsecan\n@@end\n";
    let p = plan_from(deb);
    assert_eq!((p.distro_tool, p.codename.as_str()), (Some(DistroTool::Debsecan), "bookworm"));
    let ubu = "@@os\nID=ubuntu\nVERSION_ID=\"22.04\"\n@@tools\npro\t/usr/bin/pro\n@@id\nroot\n0\n@@end\n";
    let p = plan_from(ubu);
    assert_eq!(p.distro_tool, Some(DistroTool::Pro));
    assert!(p.is_root);
    assert_eq!(plan_from("@@os\nID=arch\n@@end\n").distro_tool, None);
}

#[test]
fn users_and_images_listing() {
    let u = inventory::parse_users("@@users\nana\t1000\t/home/ana\tyes\tno\tno\tno\nbeto\t1001\t/home/beto\tno\tyes\tyes\tna\n@@root\npodman\n@@end\n");
    assert_eq!(u.users.len(), 2);
    assert!(u.users[0].podman && !u.users[0].runtime_dir);
    assert!(u.users[1].docker && u.users[1].runtime_dir);
    assert_eq!((u.users[0].linger, u.users[1].linger), (Some(false), None));
    assert!(u.root_podman && !u.root_docker);

    let podman = "@@images\n5e2b554c1c45\tdocker.io/library/alpine:3.18.0\n5e2b554c1c45\tlocalhost/mio:1\n\
                  3676c78a12ad\tdocker.io/library/debian:12.0\n0f224cd42fb8\t<none>:<none>\naaaaaaaaaaaa\t<none>:<none>\n\
                  @@containers\nc1c1c1c1c1c1\tweb\t3676c78a12ad3676c78a12ad3676c78a12ad3676c78a12ad3676c78a12ad1234\trunning\n\
                  c2c2c2c2c2c2\tvieja\t0f224cd42fb8aaaa\texited\n@@end\n";
    let l = inventory::parse_images(Engine::Podman, podman);
    assert_eq!(l.images.len(), 4);
    assert_eq!(l.images[0].tags, ["docker.io/library/alpine:3.18.0", "localhost/mio:1"]);
    let deb = l.images.iter().find(|i| i.id == "3676c78a12ad").unwrap();
    assert_eq!(deb.containers[0].name, "web");
    // Orden: con contenedores primero; sin etiqueta y sin uso, fuera.
    let v = select_images(Engine::Podman, podman, 50);
    assert_eq!(v.total, 4);
    assert_eq!(v.selected.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["3676c78a12ad", "0f224cd42fb8", "5e2b554c1c45"]);
    assert_eq!(select_images(Engine::Podman, podman, 1).selected.len(), 1);

    let docker = "@@images\nsha256:7cac34a4d72b0000000000000000000000000000000000000000000000000000\tnginx:alpine\n\
                  @@containers\n0123456789abcdef\t/proxy\tsha256:7cac34a4d72b0000000000000000000000000000000000000000000000000000\texited\n@@end\n";
    let d = inventory::parse_images(Engine::Docker, docker);
    assert_eq!(d.images[0].id, "7cac34a4d72b");
    assert_eq!(d.images[0].containers[0].name, "proxy");
    let e = inventory::parse_images(Engine::Podman, "@@images\nError: cannot connect\n@@containers\n@@end\n");
    assert!(e.error.unwrap().contains("cannot connect"));
}

#[test]
fn image_read_variants() {
    let deb = format!(
        "@@method montada\n@@os\n{}\n@@dpkgstatus\nPackage: libtasn1-6\nStatus: install ok installed\nVersion: 4.19.0-2\n\n@@end\n",
        fx!("os-release-debian.txt")
    );
    let r = inventory::parse_image(&deb);
    assert_eq!(r.method.as_deref(), Some("montada"));
    assert_eq!(r.pm, Some(PackageManager::Dpkg));
    assert_eq!(r.packages.len(), 1);
    assert_eq!(ecosystem::for_os(&r.os).as_deref(), Some("Debian:12"));
    // Anfitrión sin rpm: la primera parte pide rpm y la segunda lo trae de la imagen.
    let alma = format!(
        "@@method montada\n@@os\n{}\n@@needrpm\n@@end\n@@method rpm de la imagen\n@@rpm\n{}@@end\n",
        fx!("os-release-almalinux.txt"),
        fx!("rpm-almalinux.txt")
    );
    let r = inventory::parse_image(&alma);
    assert_eq!(r.pm, Some(PackageManager::Rpm));
    assert_eq!(r.method.as_deref(), Some("rpm de la imagen"));
    assert!(r.packages.len() > 100);
    assert!(r.error.is_none());
    let t = format!("@@os\nID=rocky\nVERSION_ID=9.0\n@@trivyver\nVersion: 0.76.2\n@@trivy\n{}@@rc 0\n@@end\n", fx!("trivy-rootfs-rocky90.tsv"));
    let r = inventory::parse_image(&t);
    let (ver, items) = r.trivy.unwrap();
    assert_eq!(ver.as_deref(), Some("0.76.2"));
    assert_eq!(items.len(), 592);
    let r = inventory::parse_image("@@error no se pudo montar la imagen: x\n@@end\n");
    assert!(r.error.unwrap().contains("montar"));
    let r = inventory::parse_image("@@os\nID=x\n@@nopkgdb\n@@end\n");
    assert!(r.error.is_some());
}

/// Los scripts tienen que ser sh válido (dash/busybox): se comprueba la sintaxis con `sh -n`.
#[cfg(unix)]
#[test]
fn scripts_are_valid_sh() {
    use std::io::Write;
    let user = scripts::UserCtx { name: "ana".into(), uid: 1000, home: "/home/ana".into() };
    let all = [
        scripts::detect_script(),
        scripts::users_script(),
        scripts::inventory_script(),
        scripts::distro_script(DistroTool::Dnf4, ""),
        scripts::distro_script(DistroTool::Dnf5, ""),
        scripts::distro_script(DistroTool::Yum, ""),
        scripts::distro_script(DistroTool::Debsecan, "bookworm"),
        scripts::distro_script(DistroTool::Pro, ""),
        scripts::distro_script(DistroTool::Zypper, ""),
        scripts::images_list_script(Engine::Podman, None),
        scripts::images_list_script(Engine::Podman, Some(&user)),
        scripts::images_list_script(Engine::Docker, None),
        scripts::images_list_script(Engine::Docker, Some(&user)),
        scripts::image_script(Engine::Podman, None, "5e2b554c1c45", true),
        scripts::image_script(Engine::Podman, Some(&user), "5e2b554c1c45", false),
        scripts::image_script(Engine::Docker, None, "sha256:5e2b554c1c45", true),
        scripts::image_script(Engine::Docker, Some(&user), "5e2b554c1c45", false),
        scripts::as_owner_script(Engine::Podman, None, "podman pull docker.io/library/nginx:1.27"),
        scripts::as_owner_script(Engine::Podman, Some(&user), "podman pull 'a b'\nsystemctl --user restart web.service"),
        scripts::as_owner_script(Engine::Docker, Some(&user), "cd /srv/app && docker compose pull"),
    ];
    for s in all {
        let mut child = std::process::Command::new("sh")
            .arg("-n")
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success(), "sh -n falló: {}\n---\n{s}", String::from_utf8_lossy(&out.stderr));
    }
    // Nada de nombres raros en los argumentos.
    assert!(!scripts::image_script(Engine::Podman, None, "abc;rm -rf /", false).contains("rm -rf"));
    let bad = scripts::UserCtx { name: "a;b".into(), uid: 1, home: "/x".into() };
    assert!(!scripts::images_list_script(Engine::Podman, Some(&bad)).contains("a;b"));
    assert!(scripts::distro_script(DistroTool::Debsecan, "x; rm").contains("debsecan --format"));
    // «Actualizar imagen» con un usuario raro: no se ejecuta nada (ni como root).
    let s = scripts::as_owner_script(Engine::Podman, Some(&bad), "podman pull x");
    assert!(!s.contains("podman pull") && s.contains("exit 1"), "{s}");
    let s = scripts::as_owner_script(Engine::Podman, Some(&user), "podman pull x");
    assert!(s.contains("runuser -u 'ana'") && s.contains("r=/run/user/1000") && s.contains("sshorus-run-1000"), "{s}");
    assert!(scripts::as_owner_script(Engine::Docker, Some(&user), "docker pull x").contains("DOCKER_HOST=unix://$s"));
}

/// «Actualizar imagen» sin el sh del contenedor: el script sale con el código de lo de dentro.
#[cfg(unix)]
#[test]
fn as_owner_script_keeps_exit_code() {
    let run = |inner: &str| {
        std::process::Command::new("sh").arg("-c").arg(scripts::as_owner_script(Engine::Podman, None, inner)).output().unwrap()
    };
    assert!(run("true").status.success());
    assert_eq!(run("echo hola; exit 3").status.code(), Some(3));
    assert_eq!(String::from_utf8_lossy(&run("echo hola").stdout), "hola\n");
}

/// Fases 1 y 2 de verdad en este PC (Linux): el inventario sale con paquetes.
#[cfg(target_os = "linux")]
#[test]
fn detect_and_inventory_run_locally() {
    let run = |s: String| {
        let out = std::process::Command::new("sh").arg("-c").arg(&s).output().unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let d = inventory::parse_detect(&run(scripts::detect_script()));
    assert!(d.complete);
    assert!(!d.os.id.is_empty());
    assert!(!d.kernel.is_empty());
    let inv = inventory::parse_inventory(&run(scripts::inventory_script()));
    assert!(inv.complete);
    if d.pm.is_some_and(|p| p != PackageManager::None) {
        assert!(inv.packages.len() > 20, "pocos paquetes: {}", inv.packages.len());
    }
}

// ───────────── Programas sueltos ─────────────

#[test]
fn upstream_programs() {
    let u = |p: &str, l: &str| ecosystem::upstream(p, l).map(|(e, n, v)| format!("{e}/{n}@{v}"));
    assert_eq!(u("node", "v18.0.0").as_deref(), Some("Bitnami/node@18.0.0"));
    assert_eq!(u("python3", "Python 3.10.0").as_deref(), Some("Bitnami/python@3.10.0"));
    assert_eq!(u("php", "PHP 8.1.0 (cli) (built: Nov 22 2021)").as_deref(), Some("Bitnami/php@8.1.0"));
    assert_eq!(u("java", "openjdk version \"17.0.1\" 2021-10-19").as_deref(), Some("Bitnami/java@17.0.1"));
    assert_eq!(u("java", "java version \"1.8.0_381\""), None);
    assert_eq!(u("nginx", "nginx version: nginx/1.20.0").as_deref(), Some("Bitnami/nginx@1.20.0"));
    assert_eq!(u("httpd", "Server version: Apache/2.4.57 (Unix)").as_deref(), Some("Bitnami/apache@2.4.57"));
    assert_eq!(u("caddy", "v2.6.0 h1:abc=").as_deref(), Some("Go/github.com/caddyserver/caddy/v2@2.6.0"));
    assert_eq!(u("podman", "podman version 4.0.0").as_deref(), Some("Go/github.com/containers/podman/v4@4.0.0"));
    assert_eq!(u("podman", "podman version 5.2.1").as_deref(), Some("Go/github.com/containers/podman/v5@5.2.1"));
    assert_eq!(u("docker", "Docker version 27.0.0, build 7d4bcd8").as_deref(), Some("Go/github.com/docker/docker@27.0.0"));
    assert_eq!(u("sudo", "Sudo version 1.9.17p2"), None);
    let deb = os(fx!("os-release-debian.txt"));
    assert!(ecosystem::is_distro_vendor(&deb, Some("Debian Nginx Maintainers <pkg-nginx-maintainers@alioth-lists.debian.net>")));
    assert!(!ecosystem::is_distro_vendor(&deb, Some("NGINX Packaging <nginx-packaging@f5.com>")));
    assert!(ecosystem::is_distro_vendor(&deb, None));
    assert!(ecosystem::is_kernel("linux") && ecosystem::is_kernel("linux-signed-amd64") && ecosystem::is_kernel("kernel"));
    assert!(!ecosystem::is_kernel("linux-base") && !ecosystem::is_kernel("util-linux"));
    assert_eq!(ecosystem::kernel_alias("linux-signed-amd64").as_deref(), Some("linux"));
    assert_eq!(ecosystem::kernel_alias("linux-signed-hwe-6.8").as_deref(), Some("linux-hwe-6.8"));
}

// ───────────── Gravedad ─────────────

#[test]
fn severity_rules() {
    assert_eq!(severity::from_text("Important"), Some(Severity::High));
    assert_eq!(severity::from_text("Moderate"), Some(Severity::Medium));
    assert_eq!(severity::from_text("negligible"), Some(Severity::Low));
    assert_eq!(severity::from_text("unimportant"), Some(Severity::Low));
    assert_eq!(severity::from_text("low**"), Some(Severity::Low));
    assert_eq!(severity::from_text("CRITICAL"), Some(Severity::Critical));
    assert_eq!(severity::from_text("not yet assigned"), None);
    assert_eq!(severity::from_score(9.8), Severity::Critical);
    assert_eq!(severity::from_score(7.0), Severity::High);
    assert_eq!(severity::from_score(4.0), Severity::Medium);
    assert_eq!(severity::from_score(0.1), Severity::Low);
    assert_eq!(severity::cvss_score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), Some(9.8));
    assert_eq!(severity::cvss_score("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:H"), Some(6.5));
    // CVSS 4.0 (va por tablas): ejemplos de la calculadora oficial de FIRST.
    assert_eq!(severity::cvss_score("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"), Some(9.3));
    assert_eq!(severity::cvss_score("CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"), Some(8.5));
    assert_eq!(severity::cvss_score("basura"), None);
    // La distro manda; si no hay, CVSS.
    assert_eq!(severity::combine(Some("low"), Some(9.8)), Severity::Low);
    assert_eq!(severity::combine(Some("not yet assigned"), Some(9.8)), Severity::Critical);
    assert_eq!(severity::combine(None, None), Severity::Unknown);
    assert_eq!(severity::from_summary_prefix("Moderate: curl security update").as_deref(), Some("Moderate"));
    assert_eq!(severity::from_summary_prefix("libtasn1-6 - security update"), None);
}
