use std::sync::mpsc;
use std::time::Duration;

use super::env::{base_command, is_file, search_env};
use super::*;

#[test]
fn ajustes_saneados() {
    let s = LocalAiSettings { mode: "otro".into(), last_cwd: Some("  ".into()), ..Default::default() }.sanitized();
    assert_eq!(s.mode, "both");
    assert_eq!(s.last_cwd, None);
    // Un settings.json antiguo (sin `localAi`) se lee con los valores por defecto.
    let st: crate::types::Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(st.local_ai, LocalAiSettings::default());
}

/// Ejecuta el programa real con los argumentos que usaría SSHorus (solo si está instalado).
/// `cargo test --lib localterm::tests::asistentes_reales -- --ignored --nocapture`
#[test]
#[ignore]
fn asistentes_reales() {
    let env = search_env();
    // `plan`: con los argumentos de SSHorus (contexto y MCP) o solo con `extra`.
    let run = |tool: AiTool, plan: bool, extra: &[&str]| -> Option<String> {
        let r = aicli::resolve_tool(&env, tool, &is_file)?;
        let home = dirs::home_dir().unwrap();
        let mut cmd = base_command(&r.program, &env, &[], &home).unwrap();
        cmd.args(&r.prefix);
        if plan {
            let m = args::McpLaunch { bridge: "/opt/sshorus/sshorus-mcp".into() };
            let input = args::LaunchInput {
                context: Some("Contexto \"de\" prueba\ncon dos líneas"),
                mcp: Some(&m),
                ..Default::default()
            };
            let p = args::launch_plan(tool.spec(), &input);
            cmd.args(&p.args);
            for (k, v) in &p.env {
                cmd.env(k, v);
            }
        }
        cmd.args(extra);
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (etx, erx) = mpsc::channel::<Option<u32>>();
        let on_data = move |b| {
            let _ = tx.send(b);
        };
        let _t = pty::spawn(cmd, 200, 50, on_data, move |c| {
            let _ = etx.send(c);
        })
        .unwrap();
        let code = erx.recv_timeout(Duration::from_secs(30)).expect("no terminó");
        let out = String::from_utf8_lossy(&rx.try_iter().flatten().collect::<Vec<u8>>()).to_string();
        println!("{tool:?} → código {code:?}\n{out}");
        Some(out)
    };
    // Codex: los -c se aplican y el servidor MCP queda con env_vars (sin token en la configuración).
    if let Some(out) = run(AiTool::Codex, true, &["mcp", "get", "sshorus", "--json"]) {
        assert!(out.contains("SSHORUS_MCP_TOKEN"), "codex no recibió env_vars");
        assert!(out.contains("/opt/sshorus/sshorus-mcp"));
        assert!(out.contains("900"));
    }
    if let Some(out) = run(AiTool::Claude, true, &["--version"]) {
        assert!(out.contains("Claude Code"));
    }
    // agy y OpenCode: que se encuentran y arrancan (sin tocar su configuración).
    for tool in [AiTool::Agy, AiTool::OpenCode] {
        if let Some(out) = run(tool, false, &["--version"]) {
            assert!(args::parse_major(&out).is_some(), "{tool:?}: versión no reconocida");
        }
    }
}
