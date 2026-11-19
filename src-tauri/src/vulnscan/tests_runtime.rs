//! Carpeta de ejecución (XDG_RUNTIME_DIR) de Podman como otro usuario, probada de verdad con `sh` en este
//! PC: lo que corre ya como el usuario (`as_user_script` / `runtime_fallback`), con el uid propio.

use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use super::model::Engine;
use super::scripts;

fn my_uid() -> u32 {
    let out = Command::new("id").arg("-u").output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap()
}

/// Carpeta temporal vacía para usar como TMPDIR.
fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sshorus-rt-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Ejecuta `script` con TMPDIR=`dir` y sin XDG_RUNTIME_DIR heredado.
fn run(script: &str, dir: &Path) -> Output {
    Command::new("sh").arg("-c").arg(script).env("TMPDIR", dir).env_remove("XDG_RUNTIME_DIR").output().unwrap()
}

fn fallback_then(uid: u32, then: &str) -> String {
    format!("{}\n{then}", scripts::runtime_fallback(uid))
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

/// El mismo texto que muestra la interfaz (`runtimeFallback` en src/features/containers/owner.ts y su
/// prueba en ownerRuntime.test.ts).
#[test]
fn fallback_text_matches_the_interface() {
    assert_eq!(
        scripts::runtime_fallback(1002),
        r#"d="${TMPDIR:-/tmp}/sshorus-run-1002"; mkdir -p -m 700 "$d" 2>/dev/null; if [ -L "$d" ] || [ "$(stat -c %u:%a "$d" 2>/dev/null)" != 1002:700 ]; then echo "La carpeta $d no es de este usuario o no tiene permisos 700: bórrala o usa otro TMPDIR" >&2; exit 1; fi; export XDG_RUNTIME_DIR="$d""#
    );
}

#[test]
fn fallback_creates_own_dir_with_700() {
    let uid = my_uid();
    let dir = tmp("ok");
    let out = run(&fallback_then(uid, "printf %s \"$XDG_RUNTIME_DIR\""), &dir);
    assert!(out.status.success(), "{}", stderr(&out));
    let d = dir.join(format!("sshorus-run-{uid}"));
    assert_eq!(String::from_utf8_lossy(&out.stdout), d.to_string_lossy());
    assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700);
    // La segunda vez reutiliza la misma carpeta.
    assert!(run(&fallback_then(uid, "true"), &dir).status.success());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fallback_refuses_foreign_open_or_linked_dir() {
    let uid = my_uid();
    // Otro uid: la carpeta queda a nombre de quien la crea, no del usuario esperado → no se usa.
    let dir = tmp("other");
    let out = run(&fallback_then(uid + 1, "echo NO"), &dir);
    assert_eq!(out.status.code(), Some(1));
    assert!(!String::from_utf8_lossy(&out.stdout).contains("NO"));
    assert!(stderr(&out).contains("no es de este usuario"), "{}", stderr(&out));
    let _ = std::fs::remove_dir_all(&dir);

    // Ya existe con 755 → no se usa (ni se toca).
    let dir = tmp("mode");
    let d = dir.join(format!("sshorus-run-{uid}"));
    std::fs::create_dir(&d).unwrap();
    std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(run(&fallback_then(uid, "echo NO"), &dir).status.code(), Some(1));
    assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o755);
    let _ = std::fs::remove_dir_all(&dir);

    // Un enlace simbólico (aunque apunte a una carpeta propia con 700) → no se usa.
    let dir = tmp("link");
    let real = dir.join("real");
    std::fs::create_dir(&real).unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o700)).unwrap();
    symlink(&real, dir.join(format!("sshorus-run-{uid}"))).unwrap();
    assert_eq!(run(&fallback_then(uid, "echo NO"), &dir).status.code(), Some(1));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn as_user_prefers_own_run_user_and_keeps_exit_code() {
    let uid = my_uid();
    let dir = tmp("asuser");
    let out = run(&scripts::as_user_script(uid, "sh -c", "printf %s \"$XDG_RUNTIME_DIR\"; exit 4"), &dir);
    assert_eq!(out.status.code(), Some(4), "{}", stderr(&out));
    let run_user = format!("/run/user/{uid}");
    let mine = std::fs::metadata(&run_user).map(|m| m.uid() == uid).unwrap_or(false);
    let expected = if mine { run_user } else { dir.join(format!("sshorus-run-{uid}")).to_string_lossy().into_owned() };
    assert_eq!(String::from_utf8_lossy(&out.stdout), expected);

    // Sin /run/user/<uid> y con una carpeta que no sale a su nombre: error claro y no se ejecuta nada.
    let out = run(&scripts::as_user_script(u32::MAX - 7, "sh -c", "echo NO"), &dir);
    assert_eq!(out.status.code(), Some(1));
    assert!(!String::from_utf8_lossy(&out.stdout).contains("NO"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// Todo el camino de «como otro usuario» (`as_owner_script`), con un `runuser` falso que solo quita
/// `-u <usuario> --`: llega su HOME, no el XDG_RUNTIME_DIR de quien eleva, y sale con el código de dentro.
#[test]
fn as_owner_script_end_to_end_with_fake_runuser() {
    let uid = my_uid();
    let dir = tmp("e2e");
    let bin = dir.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let shim = bin.join("runuser");
    std::fs::write(&shim, "#!/bin/sh\nshift 3\nexec \"$@\"\n").unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
    let user = scripts::UserCtx { name: "ana".into(), uid, home: "/home/a b".into() };
    let inner = "printf '%s|%s' \"$HOME\" \"$XDG_RUNTIME_DIR\"; exit 5";
    let s = scripts::as_owner_script(Engine::Podman, Some(&user), inner);
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap_or_default());
    let out = Command::new("sh")
        .arg("-c")
        .arg(&s)
        .env("PATH", path)
        .env("TMPDIR", &dir)
        .env("XDG_RUNTIME_DIR", "/run/user/0")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let (home, rt) = text.split_once('|').unwrap();
    assert_eq!(home, "/home/a b");
    let own = dir.join(format!("sshorus-run-{uid}")).to_string_lossy().into_owned();
    assert!(rt == format!("/run/user/{uid}") || rt == own, "{rt}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn users_script_reports_linger_column() {
    let s = scripts::users_script();
    assert!(s.contains("/var/lib/systemd/linger/$u"));
    let out = Command::new("sh").arg("-n").arg("-c").arg(&s).output().unwrap();
    assert!(out.status.success(), "{}", stderr(&out));
}
