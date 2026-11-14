use std::fs;
use std::path::{Path, PathBuf};

use super::comment::default_comment;
use super::detect::kind_from_type;
use super::list_private_keys;
use crate::localkeys::generate_ed25519;

fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sshorus-sshkeys-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    d
}

#[test]
fn kinds() {
    assert_eq!(kind_from_type("ssh-ed25519").as_deref(), Some("ed25519"));
    assert_eq!(kind_from_type("ecdsa-sha2-nistp384").as_deref(), Some("ecdsa"));
    assert_eq!(kind_from_type("sk-ssh-ed25519@openssh.com").as_deref(), Some("ed25519-sk"));
    assert_eq!(kind_from_type("ssh-ed25519-cert-v01@openssh.com"), None);
}

#[test]
fn detects_private_keys() {
    let d = tmpdir("detect");
    let ed = generate_ed25519(&d, "id_ed25519", "ana@pc", "").unwrap();
    generate_ed25519(&d, "trabajo", "", "frase secreta").unwrap();
    // Privada sin .pub: se reconoce por su cabecera.
    fs::write(d.join("suelta"), fs::read_to_string(&ed.private_path).unwrap()).unwrap();
    fs::write(d.join("id_rsa"), "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nxx\n").unwrap();
    // Estos no son llaves.
    for f in ["known_hosts", "config", "authorized_keys", "notas.txt", ".oculta"] {
        fs::write(d.join(f), "ssh-ed25519 AAAA nada\n").unwrap();
    }
    let keys = list_private_keys(&d);
    let names: Vec<&str> = keys.iter().map(|k| k.name.as_str()).collect();
    assert_eq!(names, ["id_ed25519", "id_rsa", "suelta", "trabajo"]);

    let k = &keys[0];
    assert_eq!(k.kind.as_deref(), Some("ed25519"));
    assert_eq!(k.comment, "ana@pc");
    assert_eq!(k.encrypted, Some(false));
    assert_eq!(k.public_line.as_deref(), Some(ed.public_line.as_str()));

    assert_eq!(keys[1].kind.as_deref(), Some("rsa"));
    assert_eq!(keys[1].encrypted, Some(true));
    assert_eq!(keys[1].public_line, None);

    // Sin .pub, la pública y el comentario salen de la privada.
    assert_eq!(keys[2].public_line.as_deref(), Some(ed.public_line.as_str()));
    assert_eq!(keys[2].comment, "ana@pc");

    // Cifrada: el tipo y la pública se ven igual.
    assert_eq!(keys[3].encrypted, Some(true));
    assert_eq!(keys[3].kind.as_deref(), Some("ed25519"));
    assert!(keys[3].public_line.as_deref().is_some_and(|l| l.starts_with("ssh-ed25519 ")));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn file_with_pub_but_unknown_format_counts() {
    let d = tmpdir("pubonly");
    fs::create_dir_all(&d).unwrap();
    fs::write(d.join("vieja"), [0u8, 159, 146, 150]).unwrap();
    fs::write(d.join("vieja.pub"), "ssh-rsa AAAAB3Nza viejo@pc\n").unwrap();
    let keys = list_private_keys(&d);
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].kind.as_deref(), Some("rsa"));
    assert_eq!(keys[0].comment, "viejo@pc");
    assert_eq!(keys[0].encrypted, None);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn missing_dir_and_default_comment() {
    assert!(list_private_keys(Path::new("/no/existe/sshorus")).is_empty());
    let c = default_comment();
    assert!(c.contains('@') && !c.contains(char::is_whitespace), "{c}");
}
