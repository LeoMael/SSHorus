//! Pruebas de exportar, importar y alias (con archivos temporales).

use std::fs;
use std::path::PathBuf;

use super::alias::{assign_aliases, sanitize_alias, slugify};
use super::export::{export, splice_block};
use super::import::import_preview;
use super::parse::wildmatch;
use super::*;
use crate::types::{AuthMethod, ServerProfile};

pub(super) struct Tmp(PathBuf);
impl Tmp {
    pub(super) fn new() -> Self {
        let p = std::env::temp_dir().join(format!("sshorus-sshcfg-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }
    pub(super) fn env(&self) -> SshEnv {
        SshEnv::for_home(&self.0, "yo")
    }
    pub(super) fn write(&self, rel: &str, content: &str) {
        let p = self.0.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
}
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn srv(name: &str, host: &str, port: u16, user: &str, key: Option<&str>) -> ServerProfile {
    ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        host: host.into(),
        port,
        username: user.into(),
        auth: if key.is_some() { AuthMethod::Key } else { AuthMethod::Password },
        key_path: key.map(Into::into),
        default_path: None,
        color: None,
        tmux: None,
        sudo_mode: Default::default(),
    }
}

#[test]
fn slugs_and_collisions() {
    assert_eq!(slugify("Cliente X / web"), "cliente-x-web");
    assert_eq!(slugify("  Producción  Ñandú!! "), "produccion-nandu");
    assert_eq!(slugify("***"), "servidor");
    let s = |n: &str| srv(n, "h", 22, "u", None);
    let a = assign_aliases(&[s("Web"), s("web"), s("WEB!"), s("db"), s("")]);
    assert_eq!(a, ["web", "web-2", "web-3", "db", "servidor"]);
}

#[test]
fn export_creates_file_with_private_perms() {
    let t = Tmp::new();
    let env = t.env();
    let r = export(
        &env,
        &[srv("Web prod", "10.0.0.1", 22, "deploy", Some("~/.ssh/id_ed25519")), srv("db", "db.lan", 2222, "root", None)],
    )
    .unwrap();
    assert_eq!(r.count, 2);
    let text = fs::read_to_string(&env.config).unwrap();
    assert_eq!(
        text,
        format!(
            "{BEGIN_MARKER}\nHost web-prod\n    HostName 10.0.0.1\n    User deploy\n    IdentityFile ~/.ssh/id_ed25519\n\n\
             Host db\n    HostName db.lan\n    Port 2222\n    User root\n{END_MARKER}\n"
        )
    );
    // No había archivo previo: no hace falta copia.
    assert!(!env.backup.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&env.config).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&env.ssh_dir).unwrap().permissions().mode() & 0o777, 0o700);
    }
}

#[test]
fn export_preserves_outside_and_replaces_block() {
    let t = Tmp::new();
    let env = t.env();
    let original = "# mis cosas\nServerAliveInterval 30\n\nHost github.com\n  User git\n\nHost *\n  User nadie\n";
    t.write(".ssh/config", original);

    export(&env, &[srv("a", "a.lan", 22, "u", None)]).unwrap();
    let first = fs::read_to_string(&env.config).unwrap();
    // Insertado antes del primer Host; lo de fuera, intacto.
    assert!(first.starts_with("# mis cosas\nServerAliveInterval 30\n\n# >>> SSHorus"));
    assert!(first.ends_with("# <<< SSHorus <<<\n\nHost github.com\n  User git\n\nHost *\n  User nadie\n"));
    assert_eq!(fs::read_to_string(&env.backup).unwrap(), original);

    // Reemplaza el bloque en su sitio.
    export(&env, &[srv("b", "b.lan", 22, "u", None), srv("c", "c.lan", 22, "u", None)]).unwrap();
    let second = fs::read_to_string(&env.config).unwrap();
    assert_eq!(second.matches(BEGIN_MARKER).count(), 1);
    assert!(!second.contains("a.lan"));
    assert!(second.contains("Host b\n") && second.contains("Host c\n"));
    let strip = |s: &str| {
        let b = s.find(BEGIN_MARKER).unwrap();
        let e = s.find(END_MARKER).unwrap() + END_MARKER.len();
        format!("{}{}", &s[..b], &s[e..])
    };
    assert_eq!(strip(&first), strip(&second));
    // La copia es solo la primera vez.
    assert_eq!(fs::read_to_string(&env.backup).unwrap(), original);

    // Sin servidores, el bloque desaparece y el archivo vuelve a ser el original.
    export(&env, &[]).unwrap();
    assert_eq!(fs::read_to_string(&env.config).unwrap(), original);
}

#[test]
fn export_appends_when_no_hosts_and_resets_scope() {
    // Sin Host/Match: va al final.
    let out = splice_block(b"Compression yes", &[srv("x", "x", 22, "u", None)]).unwrap();
    let out = String::from_utf8(out).unwrap();
    assert!(out.starts_with("Compression yes\n\n# >>> SSHorus"));
    // Bloque (movido a mano) seguido de opciones sueltas: cierra con `Host *`.
    let src = format!("{BEGIN_MARKER}\n{END_MARKER}\nForwardAgent no\n");
    let out = String::from_utf8(splice_block(src.as_bytes(), &[srv("x", "x", 22, "u", None)]).unwrap()).unwrap();
    assert!(out.contains("Host *\n# <<< SSHorus <<<\nForwardAgent no\n"));
    // Bloque sin cierre: error, no se toca nada.
    let bad = format!("Host a\n{BEGIN_MARKER}\nHost x\n");
    assert!(splice_block(bad.as_bytes(), &[srv("x", "x", 22, "u", None)]).is_err());
}

#[test]
fn export_keeps_bytes_and_skips_unchanged_write() {
    let t = Tmp::new();
    let env = t.env();
    // Bytes no UTF-8 y CRLF fuera del bloque se conservan.
    let mut original = b"Host raro\r\n  User \xff\xfe\r\n".to_vec();
    original.extend_from_slice(b"# fin sin salto");
    t.write(".ssh/config", "");
    fs::write(&env.config, &original).unwrap();
    export(&env, &[srv("x", "x", 22, "u", None)]).unwrap();
    let after = fs::read(&env.config).unwrap();
    let b = after.windows(BEGIN_MARKER.len()).position(|w| w == BEGIN_MARKER.as_bytes()).unwrap();
    assert_eq!(b, 0);
    assert!(after.ends_with(&original));
    let mtime = fs::metadata(&env.config).unwrap().modified().unwrap();
    export(&env, &[srv("x", "x", 22, "u", None)]).unwrap();
    assert_eq!(fs::read(&env.config).unwrap(), after);
    assert_eq!(fs::metadata(&env.config).unwrap().modified().unwrap(), mtime);
}

#[test]
fn import_parses_hosts_includes_and_wildcards() {
    let t = Tmp::new();
    let env = t.env();
    t.write(
        ".ssh/config",
        &format!(
            "User global-user\n\
             Include conf.d/*.conf\n\
             Include ~/otros/extra\n\
             \n\
             {BEGIN_MARKER}\nHost sshorus-propio\n    HostName propio.lan\n{END_MARKER}\n\
             Host web web-alias\n\
             \x20   HostName 10.0.0.5\n\
             \x20   Port 2200\n\
             \x20   IdentityFile \"~/.ssh/mi llave\"\n\
             \x20   Port 9999\n\
             Host *.lan !nope.lan\n\
             \x20   User lan-user\n\
             Host nas.lan nope.lan\n\
             Host db\n\
             \x20   HostName=db.example.com\n\
             \x20   User root\n\
             Host ya-guardado\n\
             \x20   HostName saved.example.com\n\
             \x20   User admin\n\
             Match host foo\n\
             \x20   User match-user\n\
             Host *\n\
             \x20   User star-user\n\
             \x20   Port 2022\n"
        ),
    );
    t.write(".ssh/conf.d/b.conf", "Host from-b\n    HostName b.example.com\n");
    t.write(".ssh/conf.d/a.conf", "Host from-a\n    HostName a.example.com\n    User ana\n");
    t.write(".ssh/conf.d/ignored.txt", "Host no-incluido\n");
    t.write("otros/extra", "Host extra\n    HostName extra.example.com\n");

    let existing = [srv("guardado", "SAVED.example.com", 2022, "global-user", None)];
    let got = import(&env, &existing).unwrap();
    let summary: Vec<String> = got
        .iter()
        .map(|s| format!("{} {}@{}:{} {:?} {:?}", s.name, s.username, s.host, s.port, s.auth, s.key_path))
        .collect();
    assert_eq!(
        summary,
        [
            // El User global va primero → gana a los de cada Host. Port de `Host *` aplica si no hay otro.
            "from-a global-user@a.example.com:2022 Password None",
            "from-b global-user@b.example.com:2022 Password None",
            "extra global-user@extra.example.com:2022 Password None",
            "web global-user@10.0.0.5:2200 Key Some(\"~/.ssh/mi llave\")",
            // web-alias: mismo host/puerto/usuario que web → no se repite.
            "nas.lan global-user@nas.lan:2022 Password None",
            "nope.lan global-user@nope.lan:2022 Password None",
            "db global-user@db.example.com:2022 Password None",
        ]
    );
    assert!(got.iter().all(|s| s.id.is_empty()));
}

#[test]
fn import_first_value_wins_and_defaults() {
    let t = Tmp::new();
    let env = t.env();
    t.write(
        ".ssh/config",
        "Host *.lan !nope.lan\n  User lan-user\nHost nas.lan nope.lan\n  User own\nHost bare\nHost *\n  User star\n",
    );
    let got = import(&env, &[]).unwrap();
    let summary: Vec<String> = got.iter().map(|s| format!("{}@{}:{}", s.username, s.host, s.port)).collect();
    assert_eq!(summary, ["lan-user@nas.lan:22", "own@nope.lan:22", "star@bare:22"]);

    // Sin User en ningún sitio → usuario local; llave por defecto si existe.
    t.write(".ssh/config", "Host solo\n");
    t.write(".ssh/id_ed25519", "x");
    let got = import(&env, &[]).unwrap();
    assert_eq!(got[0].username, "yo");
    assert_eq!(got[0].auth, AuthMethod::Key);
    assert_eq!(got[0].key_path.as_deref(), Some("~/.ssh/id_ed25519"));

    // Sin archivo → vacío.
    fs::remove_file(&env.config).unwrap();
    assert!(import(&env, &[]).unwrap().is_empty());
}

#[test]
fn export_then_import_ignores_own_block() {
    let t = Tmp::new();
    let env = t.env();
    export(&env, &[srv("a", "a.lan", 22, "u", None)]).unwrap();
    assert!(import(&env, &[]).unwrap().is_empty());
}

#[test]
fn import_preview_marks_existing() {
    let t = Tmp::new();
    let env = t.env();
    t.write(
        ".ssh/config",
        "Host nuevo\n  HostName n.lan\n  User u\nHost viejo\n  HostName v.lan\n  User u\nHost web\n  HostName w2.lan\n  User u\n",
    );
    let existing = [srv("Viejo guardado", "V.lan", 22, "u", None), srv("web", "w.lan", 22, "u", None)];
    let got = import_preview(&env, &existing).unwrap();
    let s: Vec<String> = got
        .iter()
        .map(|c| format!("{} {:?} {:?}", c.server.name, c.existing_name, c.alias_used_by))
        .collect();
    assert_eq!(
        s,
        [
            "nuevo None None",
            "viejo Some(\"Viejo guardado\") None",
            "web None Some(\"web\")",
        ]
    );
    assert_eq!(got[1].existing_id.as_deref(), Some(existing[0].id.as_str()));
    // `import` sigue omitiendo los existentes.
    let names: Vec<String> = import(&env, &existing).unwrap().into_iter().map(|s| s.name).collect();
    assert_eq!(names, ["nuevo", "web"]);
}

#[test]
fn sanitize_alias_rules() {
    assert_eq!(sanitize_alias("  Mi.Server_1-a ").unwrap(), "mi.server_1-a");
    for bad in ["", "  ", "a b", "web*", "a?", "!x", "-x", ".x", "ñandu", &"a".repeat(65)] {
        assert!(sanitize_alias(bad).is_err(), "{bad}");
    }
}

#[test]
fn split_line_variants() {
    assert_eq!(split_line("  # nada"), None);
    assert_eq!(split_line("HostName=x"), Some(("hostname".into(), vec!["x".into()])));
    assert_eq!(split_line("Host = a b # comentario"), Some(("host".into(), vec!["a".into(), "b".into()])));
    assert_eq!(
        split_line("IdentityFile \"/a b/c\" d"),
        Some(("identityfile".into(), vec!["/a b/c".into(), "d".into()]))
    );
    assert!(wildmatch("*.lan", "nas.lan") && !wildmatch("*.lan", "nas.lan2") && wildmatch("h?st*", "host1"));
}
