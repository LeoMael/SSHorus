//! Pruebas con el motor simulado de `tests.rs`: el envoltorio de sudo y `run_command` con
//! contraseña. `FakeSudo` y `ui_kinds` siguen en `tests.rs` (los usan otras pruebas).

use super::*;

#[test]
fn sudo_detection() {
    for c in ["sudo whoami", "echo hola | sudo tee /etc/x", "ls && sudo -u postgres psql", "x=$(sudo cat /etc/shadow)", "sudo"] {
        assert!(policy::uses_sudo(c), "{c}");
    }
    for c in ["ls", "grep -r sudoers /etc", "pseudo x", "doas apk add x", "cat /etc/sudo.conf", "visudo -c"] {
        assert!(!policy::uses_sudo(c), "{c}");
    }
}

#[test]
fn sudo_wrapper_never_puts_the_password_or_command_in_argv() {
    let w = crate::mcp::sudo::wrap("sudo useradd -m ana", SUDO_PW).unwrap();
    // Línea de comandos remota (visible con ps): solo el arranque fijo.
    assert!(!w.command.contains("s3cr3t") && !w.command.contains("useradd"), "{}", w.command);
    assert!(w.command.starts_with("sh -c 'eval \"$(dd bs=1 count="), "{}", w.command);
    // La contraseña va al final del stdin, tras el script, en una sola línea.
    let stdin = String::from_utf8(w.stdin.to_vec()).unwrap();
    assert!(stdin.ends_with(&format!("\n{SUDO_PW}\n")), "{stdin}");
    assert_eq!(stdin.matches("s3cr3t").count(), 1);
    // El script no lleva la contraseña.
    assert!(!crate::mcp::sudo::script("sudo x").contains("s3cr3t"));
    // Contraseñas que no se pueden enviar en una línea.
    assert!(crate::mcp::sudo::wrap("sudo x", "a\nb").is_err());
    assert!(crate::mcp::sudo::wrap("sudo x", "").is_err());
    assert!(crate::mcp::sudo::wrap("sudo x", &"x".repeat(501)).is_err());
}

#[test]
fn sudo_failures_need_code_and_mark() {
    use crate::mcp::sudo::{failure, SudoFailure};
    assert_eq!(failure(Some(97), "__TV_SUDO_BAD__\n"), Some(SudoFailure::BadPassword));
    assert_eq!(failure(Some(96), "x\n__TV_SUDO_DENIED__\n"), Some(SudoFailure::Denied));
    assert_eq!(failure(Some(95), "__TV_SUDO_TTY__"), Some(SudoFailure::TtyRequired));
    assert_eq!(failure(Some(94), "__TV_SUDO_NOTMP__"), Some(SudoFailure::NoTemp));
    assert_eq!(failure(Some(93), "__TV_NO_SUDO__"), Some(SudoFailure::NoSudo));
    // El comando del asistente puede salir con 97 por su cuenta: sin la marca no es un fallo de sudo.
    assert_eq!(failure(Some(97), "otra cosa"), None);
    assert_eq!(failure(Some(0), "__TV_SUDO_BAD__"), None);
    assert_eq!(failure(None, "__TV_SUDO_BAD__"), None);
    let mut t = format!("a {SUDO_PW} b {SUDO_PW}");
    crate::mcp::sudo::redact(&mut t, SUDO_PW);
    assert_eq!(t, "a ******** b ********");
}

#[cfg(unix)]
#[test]
fn sudo_wrapper_runs_with_a_real_shell() {
    let fake = FakeSudo::new(SUDO_PW);
    let work = fake.work();

    // sudo whoami → root (con la contraseña por el askpass).
    let r = fake.run_wrapped("sudo whoami", SUDO_PW);
    assert_eq!((r.exit_code, r.stdout.as_str()), (Some(0), "root\n"), "{}", r.stderr);
    assert_eq!(fake.log(), ["ok S", "ok A"], "una comprobación (-S -v) y el comando (-A)");
    assert!(fake.leftovers().is_empty(), "{:?}", fake.leftovers());

    // Compuestos: tubería con el stdin propio, varios sudo, sudo dentro de otro shell y por xargs/env.
    let cmd = format!(
        "echo hola | sudo tee {work}/x >/dev/null && sudo sh -c 'cat {work}/x' && sudo whoami && \
         sh -c 'sudo whoami' && echo whoami | xargs sudo && env sudo whoami"
    );
    let r = fake.run_wrapped(&cmd, SUDO_PW);
    assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
    assert_eq!(r.stdout, "hola\nroot\nroot\nroot\nroot\n");
    let log = fake.log();
    assert_eq!(log.iter().filter(|l| l.as_str() == "ok S").count(), 2, "{log:?}");
    assert_eq!(log.iter().filter(|l| l.as_str() == "ok A").count(), 1 + 6, "{log:?}");
    assert!(!log.iter().any(|l| l.starts_with("bad")), "{log:?}");
    assert!(fake.leftovers().is_empty());

    // Varios sudo a la vez (tubería): cada uno recibe la contraseña entera.
    for _ in 0..5 {
        let r = fake.run_wrapped("sudo whoami | sudo cat | sudo cat | sudo cat | sudo cat", SUDO_PW);
        assert_eq!((r.exit_code, r.stdout.as_str()), (Some(0), "root\n"), "{}", r.stderr);
        assert!(!fake.log().iter().any(|l| l.starts_with("bad")), "{:?}", fake.log());
    }

    // El código de salida del comando se conserva; su stdin está cerrado (no se queda esperando).
    let r = fake.run_wrapped("sudo sh -c 'exit 7'", SUDO_PW);
    assert_eq!(r.exit_code, Some(7));
    let r = fake.run_wrapped("sudo cat; echo fin", SUDO_PW);
    assert_eq!(r.stdout, "fin\n");

    // El comando no ve la contraseña: ni en variables, ni en el entorno, ni en la salida.
    let r = fake.run_wrapped("sudo true; set; env; echo \"p=[$p] c=[$c]\"; s=$(command -v sudo); cat \"$s\" \"${s%/*/*}/a\"; true", SUDO_PW);
    assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
    assert!(r.stdout.contains("p=[]") && r.stdout.contains("SUDO_ASKPASS"), "{}", r.stdout);
    for out in [&r.stdout, &r.stderr] {
        assert!(!out.contains("s3cr3t"), "la contraseña apareció en la salida:\n{out}");
    }
    assert!(fake.leftovers().is_empty());

    // Un `sudo -S` del propio comando no recibe también -A (sudo no acepta los dos juntos).
    let r = fake.run_wrapped("echo nada | sudo -S true; echo $?", SUDO_PW);
    assert!(!r.stderr.contains("may not be used together"), "{}", r.stderr);
}

#[cfg(unix)]
#[test]
fn sudo_wrapper_bad_password_fails_fast_with_one_attempt() {
    let fake = FakeSudo::new(SUDO_PW);
    let r = fake.run_wrapped("sudo whoami; echo no-debe-llegar", "otra");
    assert_eq!(crate::mcp::sudo::failure(r.exit_code, &r.stderr), Some(crate::mcp::sudo::SudoFailure::BadPassword), "{r:?}");
    assert!(!r.stdout.contains("no-debe-llegar"));
    assert_eq!(fake.log(), ["bad S"], "un solo intento fallido");
    assert!(fake.leftovers().is_empty());
    assert!(r.duration_ms < 5000, "{} ms", r.duration_ms);
}

fn sudo_core(fake: Option<&FakeSudo>) -> McpCore<Mock> {
    let c = core();
    *c.backend.local.lock().unwrap() = fake.cloned();
    *c.backend.sudo_reply.lock().unwrap() = json!({ "elevate": true, "password": SUDO_PW });
    c
}

#[cfg(unix)]
#[tokio::test]
async fn run_command_with_sudo_uses_the_password_without_showing_it() {
    let fake = FakeSudo::new(SUDO_PW);
    let c = sudo_core(Some(&fake));
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("Código de salida: 0") && out.text.contains("root"), "{}", out.text);
    assert_eq!(asked(&c), 1, "sudo pide permiso siempre");
    assert_eq!(ui_kinds(&c), ["sudo"]);
    let (_, payload) = c.backend.ui_payloads.lock().unwrap()[0].clone();
    assert_eq!(payload["sessionId"], "ss-full");
    assert_eq!(payload["profileId"], "s-full");
    // Nada con la contraseña: ni la respuesta, ni la línea de comandos, ni el registro.
    assert!(!out.text.contains("s3cr3t"));
    assert!(ran(&c).iter().all(|cmd| !cmd.contains("s3cr3t") && !cmd.contains("whoami")));
    let log = serde_json::to_string(&c.audit.list()).unwrap();
    assert!(!log.contains("s3cr3t"), "{log}");
    assert!(log.contains("(con sudo)"), "{log}");
    assert!(fake.leftovers().is_empty());
}

#[tokio::test]
async fn sudo_output_is_redacted_and_non_sudo_commands_do_not_ask() {
    let c = sudo_core(None);
    *c.backend.exec_result.lock().unwrap() = Some(ExecResult {
        stdout: format!("la clave es {SUDO_PW}\n"),
        stderr: format!("[{SUDO_PW}]"),
        exit_code: Some(0),
        duration_ms: 1,
        truncated: false,
        timed_out: false,
    });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo cat /tmp/x" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert!(!out.text.contains("s3cr3t"), "{}", out.text);
    assert!(out.text.contains("la clave es ********"), "{}", out.text);
    // La contraseña solo viajó por stdin.
    let stdin = c.backend.stdins.lock().unwrap()[0].clone().unwrap();
    assert!(String::from_utf8_lossy(&stdin).contains(SUDO_PW));

    // Sin sudo: ni se pide la contraseña ni hay stdin.
    *c.backend.exec_result.lock().unwrap() = None;
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "touch /tmp/pseudo" })).await;
    assert!(!out.is_error);
    assert_eq!(ui_kinds(&c), ["sudo"]);
    assert_eq!(c.backend.stdins.lock().unwrap()[1], None);
    assert_eq!(ran(&c)[1], "touch /tmp/pseudo");
}

#[tokio::test]
async fn sudo_not_needed_or_canceled() {
    // root o sudo sin contraseña: la interfaz dice que no hace falta y se ejecuta tal cual.
    let c = core();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(!out.is_error, "{}", out.text);
    assert_eq!(ran(&c), ["sudo whoami"]);
    assert_eq!(c.backend.stdins.lock().unwrap()[0], None);

    // El usuario cierra el diálogo de la contraseña: denegado y no se ejecuta.
    *c.backend.sudo_reply.lock().unwrap() = json!({ "canceled": true });
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.is_error);
    assert_eq!(out.text, crate::mcp::core::SUDO_CANCELED_MSG);
    assert_eq!(ran(&c).len(), 1);
    assert_eq!(c.audit.list()[0].status, AuditStatus::Denied);

    // SSHorus se bloquea mientras se busca la contraseña: nada.
    let c = sudo_core(None);
    c.backend.lock_on_sudo.store(true, Ordering::SeqCst);
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert_eq!(out.text, LOCKED_MSG);
    assert!(ran(&c).is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn sudo_bad_password_is_clear_and_rejected_in_the_ui() {
    let fake = FakeSudo::new("la-buena");
    let c = sudo_core(Some(&fake));
    let started = std::time::Instant::now();
    let out = call(&c, "run_command", json!({ "server": "web-prod", "command": "sudo whoami" })).await;
    assert!(out.is_error);
    assert!(out.text.contains("Contraseña de sudo incorrecta"), "{}", out.text);
    assert!(!out.text.contains("s3cr3t"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(ui_kinds(&c), ["sudo", "sudo-rejected"]);
    let (_, payload) = c.backend.ui_payloads.lock().unwrap()[1].clone();
    assert_eq!(payload["sessionId"], "ss-full");
    assert_eq!(fake.log(), ["bad S"]);
    assert_eq!(c.audit.list()[0].status, AuditStatus::Error);
}

#[cfg(unix)]
#[tokio::test]
async fn catalog_command_with_sudo_flag() {
    let fake = FakeSudo::new(SUDO_PW);
    let c = sudo_core(Some(&fake));
    c.set_catalog(vec![CatalogEntry {
        id: "usuarios.crear-usuario".into(),
        category: "Usuarios".into(),
        name: "Crear usuario".into(),
        description: None,
        command: "sudo useradd -m {{usuario}}".into(),
        dangerous: false,
        sudo: true,
        read_only: false,
        interactive: false,
        perm: None,
        scope: None,
    }]);
    let out = call(
        &c,
        "run_catalog_command",
        json!({ "server": "web-prod", "id": "usuarios.crear-usuario", "vars": { "usuario": "ana" } }),
    )
    .await;
    assert!(!out.is_error, "{}", out.text);
    assert!(out.text.contains("useradd -m ana"), "{}", out.text);
    assert_eq!(asked(&c), 1);
    assert_eq!(ui_kinds(&c), ["sudo"]);
    assert!(!out.text.contains("s3cr3t"));
    assert!(fake.leftovers().is_empty());
}

#[tokio::test]
async fn catalog_sudo_flag_always_asks() {
    // Marcado «sudo» aunque el texto no diga sudo: SSHorus pone la contraseña, así que se pregunta siempre.
    let c = sudo_core(None);
    c.set_catalog(vec![CatalogEntry {
        id: "x.reiniciar".into(),
        category: "X".into(),
        name: "Reiniciar".into(),
        description: None,
        command: "systemctl restart nginx".into(),
        dangerous: false,
        sudo: true,
        read_only: true,
        interactive: false,
        perm: None,
        scope: None,
    }]);
    set_answer(&c, Answer::Give(Decision::Always));
    for _ in 0..2 {
        let out = call(&c, "run_catalog_command", json!({ "server": "web-prod", "id": "x.reiniciar" })).await;
        assert!(!out.is_error, "{}", out.text);
    }
    assert_eq!(asked(&c), 2);
    let reqs = c.backend.asked.lock().unwrap().clone();
    assert!(!reqs[0].can_remember && reqs[0].danger.iter().any(|d| d.contains("sudo")), "{:?}", reqs[0]);
    assert!(c.config.get().remembered_of("s-full").is_empty());
    assert_eq!(ui_kinds(&c), ["sudo", "sudo"]);
}
