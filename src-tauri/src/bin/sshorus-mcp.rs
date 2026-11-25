//! `sshorus-mcp`: puente stdio para asistentes de IA (Claude Desktop, Claude Code, Codex…).
//!
//! Reenvía los mensajes MCP a SSHorus abierto (`http://127.0.0.1:<puerto>/mcp`). No ve contraseñas: solo
//! necesita un token, que se consigue sin copiar nada con `sshorus-mcp pair` (queda en el llavero del
//! sistema) o, a mano, con la variable `SSHORUS_MCP_TOKEN`. Toda la lógica vive en la app.
//!
//! Uso: dile a tu IA «conéctate a SSHorus ejecutando sshorus-mcp pair».

// La carpeta se comparte con la app: cada lado usa una parte (la app, por ejemplo, solo los tipos de `wire`).
#[allow(dead_code)]
#[path = "../mcp/bridge/mod.rs"]
mod bridge;

fn runtime() -> tokio::runtime::Runtime {
    match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("sshorus-mcp: no se pudo iniciar: {e}");
            std::process::exit(1);
        }
    }
}

fn pair(args: &[String]) -> i32 {
    let parsed = match bridge::pair::parse_args(args) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("sshorus-mcp pair: {e}\n\n{}", bridge::pair::HELP);
            return 1;
        }
    };
    let report = runtime().block_on(bridge::pair::run(&parsed, env!("CARGO_PKG_VERSION"), bridge::wire::KEYRING_SERVICE));
    report.print(parsed.json);
    report.exit_code()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("pair") {
        if args.iter().any(|a| a == "--help" || a == "-h") {
            println!("{}", bridge::pair::HELP);
            return;
        }
        std::process::exit(pair(&args[1..]));
    }
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("sshorus-mcp {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!(
            "sshorus-mcp {}: puente MCP por stdio hacia SSHorus.\n\n\
             Emparejar un asistente (sin copiar secretos):\n  sshorus-mcp pair [--client …] [--scope user|project] [--json]\n\n\
             Variables:\n  SSHORUS_MCP_TOKEN   token copiado a mano (Ajustes → Asistentes de IA)\n  \
             SSHORUS_MCP_CLIENT  qué asistente es (lo pone «pair»)\n  \
             SSHORUS_MCP_PORT    puerto (por defecto, el de SSHorus o 47821)\n\n\
             SSHorus tiene que estar abierto. Si no, el asistente verá: «{}»",
            env!("CARGO_PKG_VERSION"),
            bridge::CLOSED_MSG
        );
        return;
    }
    let cfg = bridge::BridgeConfig::from_env(env!("CARGO_PKG_VERSION"));
    if cfg.token.is_none() {
        eprintln!("sshorus-mcp: sin token; empareja este asistente con «sshorus-mcp pair»");
    }
    runtime().block_on(async move {
        let input = tokio::io::BufReader::new(tokio::io::stdin());
        bridge::run(cfg, input, tokio::io::stdout()).await;
    });
}
