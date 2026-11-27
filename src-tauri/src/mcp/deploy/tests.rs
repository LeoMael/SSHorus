//! Pruebas de la lógica de despliegue: validación, scripts (sintaxis con `sh -n` y archivos escritos de
//! verdad), DNS y estado.

use std::collections::BTreeMap;

use super::app_script::{self, AppSpec, ImageSource, Run};
use super::{check, dns, status, user_script};

fn spec(run: Run) -> AppSpec {
    AppSpec {
        user: "blog".into(),
        name: "blog".into(),
        run,
        port: Some(8080),
        container_port: Some(80),
        public: false,
        env: BTreeMap::from([(
            "DB_URL".to_string(),
            "postgres://u:p@x/db?a=1&b='2'".to_string(),
        )]),
        volumes: vec![("data".into(), "/var/lib/blog".into())],
        copy_from: Some("/home/deploy/sshorus-deploy/blog".into()),
    }
}

fn container(source: ImageSource) -> Run {
    Run::Container {
        image: "docker.io/library/nginx:1.27".into(),
        source,
    }
}

// ───────────────────────── Validación ─────────────────────────

#[test]
fn names_and_values_reject_anything_that_could_extend_a_command() {
    assert_eq!(check::user_name(" blog ").unwrap(), "blog");
    for bad in [
        "root",
        "Blog",
        "1app",
        "a;rm",
        "a b",
        "",
        "a$(x)",
        "a".repeat(33).as_str(),
    ] {
        assert!(check::user_name(bad).is_err(), "{bad}");
    }
    assert!(check::app_name("mi-app.v2").is_ok());
    for bad in ["../x", "a..b", "-x", "a/b", "A", "a b"] {
        assert!(check::app_name(bad).is_err(), "{bad}");
    }
    assert!(check::image("ghcr.io/org/app@sha256:abc").is_ok());
    for bad in ["x y", "a;b", "-it", "$(x)", "a\nb"] {
        assert!(check::image(bad).is_err(), "{bad}");
    }
    assert_eq!(
        check::domain("App.Ejemplo.com.").unwrap(),
        "app.ejemplo.com"
    );
    for bad in [
        "localhost",
        "1.2.3.4",
        "http://a.com",
        "a.com:80",
        "-a.com",
        "a..com",
        "*.a.com",
        "a .com",
    ] {
        assert!(check::domain(bad).is_err(), "{bad}");
    }
    assert!(check::port(0).is_err() && check::port(70000).is_err() && check::port(443).is_ok());
    assert!(check::public_key("ssh-ed25519 AAAAC3Nza mi@pc").is_ok());
    assert!(check::public_key("ssh-ed25519 AAAA x\nssh-rsa AAAA y").is_err());
    assert!(check::unit("caddy").is_ok() && check::unit("a;b").is_err());
}

#[test]
fn env_volumes_exec_and_paths_are_checked() {
    let ok = BTreeMap::from([("A_1".to_string(), "x y $z".to_string())]);
    assert!(check::env(&ok, true).is_ok());
    assert!(check::env(&BTreeMap::from([("1A".into(), "x".into())]), false).is_err());
    assert!(check::env(&BTreeMap::from([("A".into(), "x\ny".into())]), false).is_err());
    assert!(check::env(&BTreeMap::from([("A".into(), "it's".into())]), true).is_err());
    assert!(check::env(&BTreeMap::from([("A".into(), "it's".into())]), false).is_ok());

    assert_eq!(
        check::volume("data:/var/lib/app").unwrap(),
        ("data".into(), "/var/lib/app".into())
    );
    for bad in [
        "../etc:/x",
        "/etc:/x",
        "data",
        "data:rel",
        "a b:/x",
        ".ssh:/x",
        "data:/x/../y",
    ] {
        assert!(check::volume(bad).is_err(), "{bad}");
    }
    assert_eq!(
        check::exec_start("./bin/app --p 50%", "blog").unwrap(),
        "%h/apps/blog/bin/app --p 50%%"
    );
    assert_eq!(
        check::exec_start("/usr/bin/node server.js", "blog").unwrap(),
        "/usr/bin/node server.js"
    );
    assert!(check::exec_start("a\nb", "blog").is_err());
    assert!(check::server_path("/home/u/x/", "copy_from").unwrap() == "/home/u/x");
    assert!(
        check::server_path("rel/x", "copy_from").is_err()
            && check::server_path("/a/../b", "copy_from").is_err()
    );
}

// ───────────────────────── Scripts ─────────────────────────

#[test]
fn container_unit_binds_to_localhost_and_uses_env_file_and_volumes() {
    let s = spec(container(ImageSource::Pull));
    let unit = s.unit_lines().join("\n");
    assert!(unit.contains("-p 127.0.0.1:8080:80"), "{unit}");
    assert!(unit.contains("--env-file=%h/.config/sshorus/blog.env"));
    assert!(unit.contains("-v %h/apps/blog/data:/var/lib/blog:Z"));
    assert!(unit.contains("--name blog") && unit.ends_with("WantedBy=default.target"));
    assert!(unit.contains("ExecStart=podman run") && unit.contains("docker.io/library/nginx:1.27"));
    let public = AppSpec {
        public: true,
        ..s.clone()
    }
    .unit_lines()
    .join("\n");
    assert!(public.contains("-p 8080:80") && !public.contains("127.0.0.1"));
    assert_eq!(
        s.env_lines(),
        vec!["DB_URL=postgres://u:p@x/db?a=1&b='2'".to_string()]
    );
    let d = s.describe();
    assert!(
        d.contains("127.0.0.1:8080") && d.contains("DB_URL") && !d.contains("postgres://"),
        "{d}"
    );
}

#[test]
fn program_unit_runs_in_the_app_folder_with_quoted_env() {
    let s = AppSpec {
        volumes: vec![],
        ..spec(Run::Program("%h/apps/blog/bin/app".into()))
    };
    let unit = s.unit_lines().join("\n");
    assert!(
        unit.contains("WorkingDirectory=%h/apps/blog")
            && unit.contains("ExecStart=%h/apps/blog/bin/app")
    );
    assert!(
        unit.contains("EnvironmentFile=-%h/.config/sshorus/blog.env") && !unit.contains("podman")
    );
    assert_eq!(s.env_lines()[0], "DB_URL='postgres://u:p@x/db?a=1&b='2''");
}

#[test]
fn deploy_script_runs_as_the_app_user_and_reports_the_state() {
    let s = app_script::deploy_script(&spec(container(ImageSource::Pull)));
    assert!(s.starts_with("set -e\n"));
    assert!(s.contains("runuser -u \"$u\"") && s.contains("loginctl enable-linger"));
    assert!(s.contains("podman pull docker.io/library/nginx:1.27"));
    assert!(s.contains("tar -C \"$src\" -cf - ."));
    assert!(s.contains("systemctl --user restart blog.service") && s.contains("@@state="));
    assert!(!s.contains("rm -r"), "sin borrados recursivos");
    let build = app_script::deploy_script(&spec(container(ImageSource::Build)));
    assert!(build.contains("podman build -t docker.io/library/nginx:1.27 ."));
    let archive = app_script::deploy_script(&spec(container(ImageSource::Archive(
        "/tmp/blog.tar".into(),
    ))));
    assert!(archive.contains("f=/tmp/blog.tar") && archive.contains("asu 'podman load' < \"$f\""));
    assert_eq!(
        app_script::parse_state("x\n@@state=active\n").as_deref(),
        Some("active")
    );
    assert!(app_script::remove_script("blog", "blog").contains("disable --now blog.service"));
}

#[test]
fn create_user_script_never_adds_sudo_groups() {
    let s = user_script::create_user_script("blog", Some("ssh-ed25519 AAAAx yo@pc"));
    assert!(s.contains("u=blog") && s.contains("usermod -p '*'") && s.contains("enable-linger"));
    assert!(s.contains("/etc/subuid") && s.contains("'ssh-ed25519 AAAAx yo@pc'"));
    assert!(!s.contains("wheel") && !s.contains("-aG") && !s.contains("sudoers"));
    let done = "algo\n@@user=blog uid=1003 home=/home/blog\n";
    assert_eq!(
        user_script::parse_done(done),
        Some(("1003".into(), "/home/blog".into()))
    );
    assert_eq!(user_script::parse_done("nada"), None);
}

/// Trozos `asu '…'` del script, ya sin citar.
#[cfg(unix)]
fn inner_scripts(script: &str) -> Vec<String> {
    let re = regex::Regex::new(r"asu '((?:[^']|'\\'')*)'").unwrap();
    re.captures_iter(script)
        .map(|c| c[1].replace(r"'\''", "'"))
        .collect()
}

#[cfg(unix)]
fn sh_syntax_ok(script: &str) {
    let out = std::process::Command::new("sh")
        .arg("-n")
        .arg("-c")
        .arg(script)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "sh -n falló: {}\n{script}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[cfg(unix)]
#[test]
fn every_generated_script_is_valid_shell() {
    let mut all = vec![
        user_script::create_user_script("blog", Some("ssh-ed25519 AAAAx it's@pc")),
        user_script::create_user_script("blog", None),
        app_script::remove_script("blog", "blog"),
        dns::probe_command("app.ejemplo.com", "1.2.3.4"),
        status::probe_command(&status::StatusQuery {
            port: Some(8080),
            domain: Some("app.ejemplo.com".into()),
            unit: Some("caddy".into()),
            user: Some("blog".into()),
        }),
    ];
    for source in [
        ImageSource::Pull,
        ImageSource::Build,
        ImageSource::Archive("/tmp/a b.tar".into()),
    ] {
        all.push(app_script::deploy_script(&spec(container(source))));
    }
    all.push(app_script::deploy_script(&AppSpec {
        volumes: vec![],
        ..spec(Run::Program("%h/apps/blog/x".into()))
    }));
    for s in &all {
        sh_syntax_ok(s);
        for inner in inner_scripts(s) {
            sh_syntax_ok(&inner);
        }
    }
}

#[cfg(unix)]
#[test]
fn unit_and_env_files_are_written_byte_for_byte() {
    let dir =
        std::env::temp_dir().join(format!("sshorus-deploy-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let s = spec(container(ImageSource::Pull));
    let file = dir.join("u.service");
    let cmd = super::write_lines(&s.unit_lines(), &format!("'{}'", file.display()));
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        format!("{}\n", s.unit_lines().join("\n"))
    );
    let env = dir.join("e.env");
    let cmd = super::write_lines(&s.env_lines(), &format!("'{}'", env.display()));
    std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&env).unwrap(),
        "DB_URL=postgres://u:p@x/db?a=1&b='2'\n"
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

// ───────────────────────── DNS ─────────────────────────

#[test]
fn dns_verdicts() {
    let out =
        "@@iface\n10.0.0.5\nfe80::1\n2001:db8::5\n@@domain\napp.cdn.net.\n203.0.113.7\n@@host\n";
    let p = dns::parse(out, "203.0.113.7");
    assert!(
        p.server.contains(&"203.0.113.7".parse().unwrap())
            && !p.server.contains(&"fe80::1".parse().unwrap())
    );
    assert_eq!(dns::verdict(&p), dns::DnsVerdict::Here);
    assert!(dns::render("app.ejemplo.com", &p).contains("✓"));

    let p = dns::parse(
        "@@iface\n203.0.113.7\n@@domain\n203.0.113.7\n2001:db8::9\n",
        "vps.ejemplo.com",
    );
    assert!(matches!(dns::verdict(&p), dns::DnsVerdict::Partly { .. }));
    assert!(dns::render("a.ejemplo.com", &p).contains("2001:db8::9"));

    let p = dns::parse(
        "@@iface\n10.0.0.5\n@@domain\n@@host\n198.51.100.2\n",
        "vps.ejemplo.com",
    );
    assert_eq!(dns::verdict(&p), dns::DnsVerdict::Missing);
    assert_eq!(dns::suggested_ip(&p), Some("198.51.100.2".parse().unwrap()));
    let text = dns::render("a.ejemplo.com", &p);
    assert!(
        text.contains("registro A «a.ejemplo.com» → 198.51.100.2") && text.contains("IP:puerto"),
        "{text}"
    );

    let p = dns::parse("@@iface\n10.0.0.5\n@@domain\n104.16.1.1\n", "10.0.0.5");
    assert_eq!(dns::verdict(&p), dns::DnsVerdict::Elsewhere);
    assert!(dns::render("a.ejemplo.com", &p).contains("privadas"));
}

// ───────────────────────── Estado ─────────────────────────

#[test]
fn status_lines_explain_each_check() {
    let q = status::StatusQuery {
        port: Some(8080),
        domain: Some("app.ejemplo.com".into()),
        unit: Some("caddy".into()),
        user: Some("blog".into()),
    };
    let good = "@@listen=127.0.0.1:8080 \n@@http_local=200\n@@http=308\n@@https=200\n@@https_insecure=200\n@@cert=Feb  1 00:00:00 2027 GMT\n@@unit=active\n@@user=yes\n@@linger=yes\n@@usermgr=active\n@@procs=conmon×1 nginx×2 \n";
    let lines = status::lines(&q, &status::parse(good));
    let text = status::render(&lines);
    assert!(text.starts_with("Todo bien."), "{text}");
    assert!(
        text.contains("solo en local")
            && text.contains("caduca el Feb")
            && text.contains("nginx×2")
    );

    let bad = "@@listen=\n@@http_local=000\n@@https=000\n@@https_insecure=200\n@@unit=inactive\n@@user=yes\n@@linger=no\n@@usermgr=\n@@procs=\n";
    let text = status::render(&status::lines(&q, &status::parse(bad)));
    assert!(
        text.starts_with("Hay ")
            && text.contains("Nada escucha")
            && text.contains("certificado no es válido"),
        "{text}"
    );
    assert!(text.contains("no tiene linger") && text.contains("journalctl"));

    let proxy = "@@https=502\n@@https_insecure=502\n@@http=502\n";
    let q = status::StatusQuery {
        domain: Some("a.ejemplo.com".into()),
        ..Default::default()
    };
    assert!(
        status::render(&status::lines(&q, &status::parse(proxy)))
            .contains("httpd_can_network_connect")
    );
    let q = status::StatusQuery {
        user: Some("nadie".into()),
        ..Default::default()
    };
    assert!(
        status::render(&status::lines(&q, &status::parse("@@user=no\n"))).contains("no existe")
    );
}

/// Contra el servidor de pruebas (127.0.0.1:2222, busybox y sin systemd): las comprobaciones de solo lectura
/// funcionan ahí y se leen bien. `cargo test --lib mcp::deploy -- --ignored --test-threads=1`
#[tokio::test]
#[ignore]
async fn read_probes_on_the_test_server() {
    use crate::snippets::exec;
    let s = crate::ssh::connect::testutil::connect_test_server().await;
    let r = exec::run(&s, &dns::probe_command("example.com", "127.0.0.1"), 30)
        .await
        .unwrap();
    assert_eq!(r.exit_code, Some(0), "{r:?}");
    let p = dns::parse(&r.stdout, "127.0.0.1");
    assert!(!dns::render("example.com", &p).is_empty());

    let q = status::StatusQuery {
        port: Some(2222),
        user: Some("test".into()),
        unit: Some("sshd".into()),
        ..Default::default()
    };
    let r = exec::run(&s, &status::probe_command(&q), 30).await.unwrap();
    assert_eq!(r.exit_code, Some(0), "{r:?}");
    let v = status::parse(&r.stdout);
    assert!(v["listen"].contains("2222"), "{r:?}");
    assert_eq!(v["user"], "yes", "{r:?}");
    let text = status::render(&status::lines(&q, &v));
    assert!(text.contains("El puerto 2222 escucha"), "{text}");
}
