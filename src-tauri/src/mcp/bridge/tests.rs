//! Pruebas del puente sin red: cadena de procesos (ejemplos de `/proc`, `ps` y PowerShell), qué asistente
//! es, cómo se registra, de dónde sale el token y las opciones de `pair`.

use std::collections::HashMap;

use super::caller::{self, parse_cmdline, parse_proc_stat, parse_ps, parse_tabbed, ProcInfo};
use super::clients::{self, Setup};
use super::config::{resolve_token, PairLookup};
use super::pair::{parse_args, PairArgs};
use super::register::{fill, shell_line, snippet, Scope};
use super::wire::{self, clean_client_id};

fn proc(pid: u32, ppid: u32, name: &str, args: &[&str]) -> ProcInfo {
    ProcInfo { pid, ppid, name: name.into(), args: args.iter().map(|a| a.to_string()).collect(), cwd: None }
}

#[test]
fn proc_stat_and_cmdline() {
    // Nombre con espacios y paréntesis: se toma hasta el ÚLTIMO «)».
    let stat = "4242 (tmux: server (x)) S 4100 4242 4242 0 -1 4194560 3000";
    assert_eq!(parse_proc_stat(stat), Some(("tmux: server (x)".into(), 4100)));
    assert_eq!(parse_proc_stat("4242 (claude) R 77 1 1"), Some(("claude".into(), 77)));
    assert_eq!(parse_proc_stat("basura"), None);
    let raw = b"node\0/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js\0--resume\0";
    assert_eq!(parse_cmdline(raw), vec!["node", "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js", "--resume"]);
}

#[test]
fn walk_stops_at_init_and_loops() {
    let table: HashMap<u32, ProcInfo> = [
        (10, proc(10, 9, "sshorus-mcp", &[])),
        (9, proc(9, 8, "bash", &["/bin/bash", "-c", "sshorus-mcp pair"])),
        (8, proc(8, 7, "claude", &["claude"])),
        (7, proc(7, 1, "zsh", &["-zsh"])),
    ]
    .into();
    let chain = caller::walk(10, |pid| table.get(&pid).cloned());
    assert_eq!(chain.iter().map(|p| p.pid).collect::<Vec<_>>(), vec![9, 8, 7]);
    // Un bucle (padre de sí mismo) no cuelga.
    let looped: HashMap<u32, ProcInfo> = [(5, proc(5, 6, "a", &[])), (6, proc(6, 5, "b", &[]))].into();
    assert_eq!(caller::walk(5, |pid| looped.get(&pid).cloned()).len(), 1);
}

#[test]
fn ps_and_powershell_tables() {
    let ps = "  501   1 /sbin/launchd\n  900 501 /Applications/Codex.app/Contents/MacOS/codex --flag\n";
    let t = parse_ps(ps);
    assert_eq!(t[&900].ppid, 501);
    assert_eq!(t[&900].name, "codex");
    let tabbed = "12\t4\tclaude.exe\t\"C:\\Users\\u\\AppData\\Local\\claude.exe\" --x\r\n4\t1\texplorer.exe\t\n";
    let t = parse_tabbed(tabbed);
    assert_eq!(t[&12].args, vec!["C:\\Users\\u\\AppData\\Local\\claude.exe", "--x"]);
    assert_eq!(t[&4].name, "explorer.exe");
}

#[test]
fn detects_known_assistants_through_shells() {
    let chain = [proc(9, 8, "bash", &["/bin/bash"]), proc(8, 7, "claude", &["claude", "--continue"])];
    let d = clients::detect(&chain).unwrap();
    assert_eq!((d.id.as_str(), d.process.unwrap().pid), ("claude", 8));
    // Dentro de node: por la ruta del script.
    let chain = [proc(3, 2, "node", &["node", "/opt/node_modules/@openai/codex/bin/codex.js"])];
    assert_eq!(clients::detect(&chain).unwrap().id, "codex");
    let chain = [proc(3, 2, "claude.exe", &[])];
    assert_eq!(clients::detect(&chain).unwrap().name, "Claude Code");
    // Desconocido: el primer programa que no es una shell, con id limpio.
    let chain = [proc(3, 2, "zsh", &[]), proc(2, 1, "Mi Editor", &[])];
    let d = clients::detect(&chain).unwrap();
    assert!(d.known.is_none());
    assert_eq!(d.id, "mi-editor");
    assert!(clients::detect(&[proc(3, 2, "bash", &[])]).is_none());
}

#[test]
fn resolve_prefers_flag_then_env_then_detection() {
    let chain = [proc(8, 7, "claude", &["claude"])];
    assert_eq!(clients::resolve(None, None, &chain).unwrap().id, "claude");
    let d = clients::resolve(Some("codex"), Some("gemini"), &chain).unwrap();
    assert_eq!((d.id.as_str(), d.name.as_str()), ("codex", "Codex"));
    // El proceso solo se muestra si es el mismo asistente.
    assert!(d.process.is_none());
    assert_eq!(clients::resolve(Some("auto"), Some("gemini"), &chain).unwrap().id, "gemini");
    assert!(clients::resolve(Some("claude"), None, &chain).unwrap().process.is_some());
}

#[test]
fn client_ids_are_clean() {
    assert_eq!(clean_client_id(" Claude Code "), Some("claude-code".into()));
    assert_eq!(clean_client_id("../../etc"), Some("..-..-etc".into()));
    assert_eq!(clean_client_id("¿?"), None);
    assert_eq!(wire::keyring_user("codex"), "mcp-client:codex");
}

#[test]
fn registration_commands_and_snippets() {
    let Some(Setup::Cli { add, .. }) = clients::by_id("claude").map(|c| c.setup) else { panic!() };
    let args = fill(add, Scope::User, "claude", "/home/u/.local/bin/sshorus-mcp");
    assert_eq!(
        shell_line("claude", &args),
        "claude mcp add -s user -e SSHORUS_MCP_CLIENT=claude sshorus -- /home/u/.local/bin/sshorus-mcp"
    );
    let Some(Setup::Cli { add, scoped, .. }) = clients::by_id("codex").map(|c| c.setup) else { panic!() };
    assert!(!scoped);
    assert_eq!(fill(add, Scope::Project, "codex", "/p").join(" "), "mcp add sshorus --env SSHORUS_MCP_CLIENT=codex -- /p");
    let Some(Setup::Manual(kind)) = clients::by_id("opencode").map(|c| c.setup) else { panic!() };
    let text = snippet(kind, "opencode", "/p");
    assert!(text.contains("\"type\": \"local\"") && text.contains("SSHORUS_MCP_CLIENT") && !text.contains("TOKEN"));
}

#[test]
fn env_token_wins_then_keyring() {
    let lookup = PairLookup { client_id: "claude".into(), service: "sshorus-test".into() };
    let from_keyring = |l: &PairLookup| (l.client_id == "claude").then(|| "tvc_k".to_string());
    assert_eq!(resolve_token(Some("tv_env".into()), Some(&lookup), from_keyring), Some("tv_env".into()));
    assert_eq!(resolve_token(None, Some(&lookup), from_keyring), Some("tvc_k".into()));
    assert_eq!(resolve_token(None, None, from_keyring), None);
    assert_eq!(resolve_token(None, Some(&lookup), |_| None), None);
}

/// Con el llavero real (servicio de pruebas): `cargo test --lib bridge -- --ignored`.
#[test]
#[ignore]
fn keyring_lookup_with_test_service() {
    let lookup = PairLookup { client_id: format!("prueba-{}", std::process::id()), service: "sshorus-test".into() };
    let user = wire::keyring_user(&lookup.client_id);
    if let Err(e) = super::keyring_store::get(&lookup.service, &user) {
        eprintln!("Llavero no disponible, se omite: {e}");
        return;
    }
    assert_eq!(lookup.load(), None);
    super::keyring_store::set(&lookup.service, &user, "tvc_prueba").unwrap();
    assert_eq!(lookup.load().as_deref(), Some("tvc_prueba"));
    super::keyring_store::delete(&lookup.service, &user).unwrap();
    assert_eq!(lookup.load(), None);
}

#[test]
fn pair_options() {
    let args = |v: &[&str]| parse_args(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    assert_eq!(args(&[]).unwrap(), PairArgs { client: None, scope: Scope::User, json: false });
    let a = args(&["--client", "codex", "--scope", "project", "--json"]).unwrap();
    assert_eq!((a.client.as_deref(), a.scope, a.json), (Some("codex"), Scope::Project, true));
    assert!(args(&["--scope", "todo"]).is_err());
    assert!(args(&["--client"]).is_err());
    assert!(args(&["--otra"]).is_err());
}
