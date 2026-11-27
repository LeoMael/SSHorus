use super::creds::{normalize_token, oauth_only, OAUTH_KEY};
use super::scripts::{exec_request, session_script, token_script};
use super::*;

/// Credenciales falsas con la forma de las de Claude Code (y un MCP que no debe viajar).
const FAKE: &str = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-FALSO","refreshToken":"sk-ant-ort01-FALSO","expiresAt":1,"scopes":["user:inference"]},"mcpOAuth":{"x":{"accessToken":"MCP-SECRETO"}}}"#;

fn fake_token() -> String {
    format!("sk-ant-oat01-{}", "a".repeat(95))
}

#[test]
fn solo_viaja_claude_ai_oauth() {
    let out = oauth_only(FAKE.as_bytes()).unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
    let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
    assert_eq!(keys, [OAUTH_KEY]);
    assert_eq!(v[OAUTH_KEY]["refreshToken"], "sk-ant-ort01-FALSO");
    assert!(!String::from_utf8_lossy(&out).contains("MCP-SECRETO"));
}

#[test]
fn credenciales_malas_sin_mostrar_valores() {
    let cases = [
        "no es json sk-ant-oat01-SECRETO",
        r#"{"otra":"sk-ant-oat01-SECRETO"}"#,
        r#"{"claudeAiOauth":"sk-ant-oat01-SECRETO"}"#,
        r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-SECRETO","refreshToken":""}}"#,
    ];
    for c in cases {
        let err = oauth_only(c.as_bytes()).unwrap_err();
        assert!(!err.contains("SECRETO"), "{err}");
    }
}

#[test]
fn archivo_que_no_existe() {
    let err = creds::read_oauth(Path::new("/no/existe/.credentials.json")).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn llave_pegada() {
    let t = fake_token();
    let partida = format!("  {}\n{}\r\n", &t[..40], &t[40..]);
    assert_eq!(*normalize_token(&partida).unwrap(), t);
    for bad in ["", "sk-ant-oat01-corta", &format!("sk-ant-api03-{}", "a".repeat(95)), &format!("{t}!")] {
        let err = normalize_token(bad).unwrap_err().to_string();
        assert!(!err.contains("aaaa"), "{err}");
    }
}

#[test]
fn el_comando_no_lleva_el_secreto() {
    let (command, stdin) = exec_request(&token_script(), b"SECRETO");
    assert!(!command.contains("SECRETO"));
    assert!(!session_script().contains("SECRETO") && !token_script().contains("sk-ant"));
    assert!(stdin.ends_with(b"\nSECRETO"));
    let len = token_script().len() + 1;
    assert_eq!(command, format!("sh -c 'eval \"$(dd bs=1 count={len} 2>/dev/null)\"'"));
}

#[test]
fn errores_sin_secretos() {
    let r = |code: u32, stderr: &str| ExecResult {
        stdout: String::new(),
        stderr: stderr.into(),
        exit_code: Some(code),
        duration_ms: 1,
        truncated: false,
        timed_out: false,
    };
    let e = outcome(&r(1, "sk-ant-oat01-xx\nmkdir: Permission denied")).unwrap_err().to_string();
    assert!(e.contains("Permission denied") && !e.contains("sk-ant"), "{e}");
    assert!(outcome(&r(0, "")).is_err(), "sin ok=1 no está hecho");
    let ok = ExecResult { stdout: "backup=1\nok=1\n".into(), ..r(0, "") };
    assert!(outcome(&ok).unwrap().backup);
}

/// Ejecuta el script con `sh` en una carpeta personal de prueba (como haría el servidor).
#[cfg(unix)]
fn run_local(home: &Path, script: &str, secret: &[u8], shell: &str) -> std::process::Output {
    use std::io::Write;
    let mut child = std::process::Command::new("sh")
        .arg("-c")
        .arg(script)
        .env("HOME", home)
        .env("SHELL", shell)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(secret).unwrap();
    child.wait_with_output().unwrap()
}

#[cfg(unix)]
fn mode(p: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).unwrap().permissions().mode() & 0o777
}

#[cfg(unix)]
#[test]
fn scripts_en_una_carpeta_de_prueba() {
    let home = std::env::temp_dir().join(format!("sshorus-claude-vps-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".claude")).unwrap();
    std::fs::write(home.join(".claude/.credentials.json"), "PROPIA").unwrap();
    std::fs::write(home.join(".bashrc"), "alias ll=ls").unwrap(); // sin salto de línea al final

    let oauth = oauth_only(FAKE.as_bytes()).unwrap();
    let out = run_local(&home, &session_script(), &oauth, "/bin/bash");
    assert!(outcome(&ExecResult { stdout: String::from_utf8_lossy(&out.stdout).into(), stderr: String::new(), exit_code: out.status.code().map(|c| c as u32), duration_ms: 0, truncated: false, timed_out: false }).unwrap().backup);
    let creds = home.join(".claude/.credentials.json");
    assert_eq!(std::fs::read(&creds).unwrap(), *oauth);
    assert_eq!(mode(&creds), 0o600);
    assert_eq!(std::fs::read_to_string(home.join(".config/sshorus/claude-credentials-antes.json")).unwrap(), "PROPIA");
    assert_eq!(mode(&home.join(".config/sshorus")), 0o700);
    assert!(home.join(".config/sshorus/claude-session").exists());
    assert!(std::fs::read_to_string(home.join(".claude.json")).unwrap().contains("hasCompletedOnboarding"));
    // Copiar otra vez no pisa la copia de la sesión propia.
    run_local(&home, &session_script(), &oauth, "/bin/bash");
    assert_eq!(std::fs::read_to_string(home.join(".config/sshorus/claude-credentials-antes.json")).unwrap(), "PROPIA");

    let token = fake_token();
    for _ in 0..2 {
        let out = run_local(&home, &token_script(), token.as_bytes(), "/bin/bash");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let tok = home.join(".config/sshorus/claude-token");
    assert_eq!(std::fs::read_to_string(&tok).unwrap(), token);
    assert_eq!(mode(&tok), 0o600);
    let bashrc = std::fs::read_to_string(home.join(".bashrc")).unwrap();
    assert!(bashrc.starts_with("alias ll=ls\nif [ -r"), "{bashrc}");
    assert_eq!(bashrc.matches("# SSHorus: cuenta de Claude Code").count(), 1, "una sola vez");
    assert!(!bashrc.contains("sk-ant") && !home.join(".profile").exists());
    // La shell que lee .bashrc tiene la variable.
    let env = std::process::Command::new("sh")
        .arg("-c")
        .arg(". \"$HOME/.bashrc\"; printf %s \"$CLAUDE_CODE_OAUTH_TOKEN\"")
        .env("HOME", &home)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&env.stdout), token);

    // Llega vacío: no se toca nada.
    let out = run_local(&home, &token_script(), b"", "/bin/bash");
    assert_eq!(out.status.code(), Some(scripts::EXIT_EMPTY as i32));
    assert_eq!(std::fs::read_to_string(&tok).unwrap(), token);
    std::fs::remove_dir_all(&home).unwrap();
}

/// Contra el servidor de pruebas (127.0.0.1:2222), con credenciales falsas de una carpeta temporal:
/// `cargo test --lib localterm::claude_vps -- --ignored --test-threads=1`
#[tokio::test]
#[ignore]
async fn enviar_al_servidor_de_pruebas() {
    let session = crate::ssh::connect::testutil::connect_test_server().await;
    let dir = std::env::temp_dir().join(format!("sshorus-claude-creds-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(".credentials.json");
    std::fs::write(&path, FAKE).unwrap();

    let home = "/config/tmp-claude-vps";
    let wrap = |s: String| format!("mkdir -p {home} && HOME={home} SHELL=/bin/bash; export HOME SHELL\n{s}");
    let (command, stdin) = exec_request(&wrap(session_script()), &creds::read_oauth(&path).unwrap());
    let r = exec::run_with_stdin(&session, &command, &stdin, 30).await.unwrap();
    assert!(!outcome(&r).unwrap().backup, "{r:?}");
    let token = fake_token();
    let (command, stdin) = exec_request(&wrap(token_script()), token.as_bytes());
    outcome(&exec::run_with_stdin(&session, &command, &stdin, 30).await.unwrap()).unwrap();

    let check = format!(
        "cd {home} && stat -c '%a %n' .claude/.credentials.json .config/sshorus/claude-token && grep -c SSHorus .profile && \
         HOME={home} sh -c '. ./.profile; [ \"$CLAUDE_CODE_OAUTH_TOKEN\" = \"{token}\" ] && echo igual'; rm -rf {home}"
    );
    let r = exec::run(&session, &check, 30).await.unwrap();
    assert_eq!(r.stdout, "600 .claude/.credentials.json\n600 .config/sshorus/claude-token\n1\nigual\n", "{r:?}");
    std::fs::remove_dir_all(&dir).unwrap();
}
