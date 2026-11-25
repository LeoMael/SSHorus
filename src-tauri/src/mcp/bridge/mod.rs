//! Puente stdio → HTTP local (`sshorus-mcp`).
//!
//! Muchos clientes MCP (Claude Desktop, Claude Code con `--transport stdio`) arrancan el servidor
//! como un programa y le hablan por stdin/stdout. Este puente no sabe nada de herramientas: reenvía
//! cada mensaje JSON-RPC a la app abierta (`http://127.0.0.1:<puerto>/mcp` con el token) y escribe
//! las respuestas. Así hay UNA sola implementación de permisos, aprobación y registro: la de la app.
//!
//! - Token y puerto: ver `config` (entorno, o el llavero tras `sshorus-mcp pair`).
//! - Si la app está cerrada o el asistente no está emparejado: responde `initialize` él mismo y ofrece
//!   una sola herramienta que lo explica (`offline`). Cuando la app aparece (o el emparejado termina),
//!   avisa al cliente con `notifications/tools/list_changed` para que vuelva a pedir la lista.
//! - `pair`: el subcomando `sshorus-mcp pair` (emparejar sin copiar secretos).
//!
//! Esta carpeta se compila dos veces: dentro de la app (pruebas y tipos compartidos, `wire`) y en el
//! binario `src/bin/sshorus-mcp.rs` (con `#[path]`). Por eso solo usa crates externos, nada de `crate::`.

pub mod caller;
pub mod clients;
pub mod config;
pub mod forward;
// El binario del puente no enlaza la app: necesita su propia copia de este archivo (en la app también lo
// usa `storage::secrets`). Es el mismo código compilado dos veces, no una copia.
#[allow(clippy::duplicate_mod)]
#[path = "../../storage/keyring_store.rs"]
pub mod keyring_store;
pub mod offline;
pub mod pair;
pub mod paths;
pub mod register;
#[cfg(test)]
mod tests;
pub mod wire;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub use config::{BridgeConfig, PairLookup};
use forward::{Outgoing, Sent};
pub use offline::CLOSED_MSG;
use offline::{error_msg, tool_text, Offline};

const NO_TOKEN_MSG: &str =
    "Falta la variable SSHORUS_MCP_TOKEN: copia la configuración desde SSHorus → Ajustes → Asistentes de IA (MCP).";

/// Estado compartido entre los mensajes.
#[derive(Default)]
struct Shared {
    /// Token con el que se reenvía (puede llegar después: al emparejar sin reiniciar el puente).
    token: Option<String>,
    /// Versión acordada en `initialize` (se manda en cada petición).
    protocol: Option<String>,
    /// Nombre del cliente (va en el User-Agent: queda en el registro de SSHorus).
    client: Option<String>,
    /// Ya se está vigilando a que abra la app.
    watching: bool,
}

type SharedRef = Arc<Mutex<Shared>>;

fn lock(s: &SharedRef) -> MutexGuard<'_, Shared> {
    s.lock().unwrap_or_else(|p| p.into_inner())
}

/// Ejecuta el puente hasta que se cierre la entrada.
pub async fn run<R, W>(cfg: BridgeConfig, input: R, output: W)
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        let mut output = output;
        while let Some(line) = rx.recv().await {
            if output.write_all(line.as_bytes()).await.is_err()
                || output.write_all(b"\n").await.is_err()
                || output.flush().await.is_err()
            {
                break;
            }
        }
    });
    let shared = Arc::new(Mutex::new(Shared { token: cfg.token.clone(), ..Shared::default() }));
    let cfg = Arc::new(cfg);
    let inflight: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>> = Arc::default();
    let mut lines = input.lines();
    let mut tasks = tokio::task::JoinSet::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = tx.send(error_msg(&Value::Null, -32700, &format!("JSON no válido: {e}")));
                continue;
            }
        };
        // Cancelación: se corta la petición en curso (la app detiene lo que hacía).
        if msg.get("method").and_then(Value::as_str) == Some("notifications/cancelled")
            && let Some(id) = msg.pointer("/params/requestId")
            && let Some(h) = inflight.lock().unwrap_or_else(|p| p.into_inner()).remove(&id.to_string())
        {
            h.abort();
        }
        let key = msg.get("id").filter(|_| msg.get("method").is_some()).map(Value::to_string);
        let (cfg, shared, tx2, inflight2) = (cfg.clone(), shared.clone(), tx.clone(), inflight.clone());
        let key2 = key.clone();
        let handle = tasks.spawn(async move {
            handle_message(&cfg, &shared, &tx2, msg, line).await;
            if let Some(k) = key2 {
                inflight2.lock().unwrap_or_else(|p| p.into_inner()).remove(&k);
            }
        });
        if let Some(k) = key {
            inflight.lock().unwrap_or_else(|p| p.into_inner()).insert(k, handle);
        }
        // Libera las tareas ya terminadas.
        while tasks.try_join_next().is_some() {}
    }
    // Entrada cerrada: se espera a lo que estaba en marcha y se termina.
    while tasks.join_next().await.is_some() {}
    drop(tx);
    let _ = writer.await;
}

async fn handle_message(cfg: &Arc<BridgeConfig>, shared: &SharedRef, tx: &mpsc::UnboundedSender<String>, msg: Value, raw: String) {
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    // Solo las peticiones llevan respuesta (las notificaciones no tienen `id`).
    let id = msg.get("id").cloned().filter(|_| !method.is_empty());
    if method == "initialize"
        && let Some(name) = msg.pointer("/params/clientInfo/name").and_then(Value::as_str)
    {
        lock(shared).client = Some(name.chars().take(60).collect());
    }
    let tool = msg.pointer("/params/name").and_then(Value::as_str).filter(|_| method == "tools/call");
    let token = lock(shared).token.clone();
    let Some(token) = token else {
        let Some(id) = id else { return };
        let reply = match unpaired(cfg) {
            Some(off) if tool == Some(off.tool()) => check_paired(cfg, shared, &id, &off),
            Some(off) => vec![offline::reply(&off, &id, &method, &msg, &cfg.version)],
            None => vec![error_msg(&id, -32000, NO_TOKEN_MSG)],
        };
        for line in reply {
            let _ = tx.send(line);
        }
        return;
    };
    // La herramienta de aviso de «cerrado» solo existe en el puente.
    if tool == Some(offline::CLOSED_TOOL) {
        if let Some(id) = &id {
            let open = app_is_open(cfg.port).await;
            let text = if open { "SSHorus ya está abierto: vuelve a pedir la lista de herramientas (tools/list)." } else { CLOSED_MSG };
            let _ = tx.send(tool_text(id, text, !open));
        }
        return;
    }
    let (protocol, client) = {
        let s = lock(shared);
        (s.protocol.clone(), s.client.clone())
    };
    let out = Outgoing { port: cfg.port, token: &token, version: &cfg.version, protocol: protocol.as_deref(), client: client.as_deref() };
    match forward::post(&out, raw).await {
        Sent::Messages(list) => {
            for line in list {
                if method == "initialize"
                    && let Ok(v) = serde_json::from_str::<Value>(&line)
                    && let Some(pv) = v.pointer("/result/protocolVersion").and_then(Value::as_str)
                {
                    lock(shared).protocol = Some(pv.to_string());
                }
                let _ = tx.send(line);
            }
        }
        Sent::HttpError(m) => {
            if let Some(id) = id {
                let _ = tx.send(error_msg(&id, -32000, &m));
            }
        }
        Sent::Closed => {
            let Some(id) = id else { return };
            let _ = tx.send(offline::reply(&Offline::Closed, &id, &method, &msg, &cfg.version));
            if method == "tools/list" {
                watch_for_app(cfg.clone(), shared.clone(), tx.clone());
            }
        }
    }
}

/// Sin token: el aviso de «sin emparejar» (None si no hay a quién buscar en el llavero).
fn unpaired(cfg: &BridgeConfig) -> Option<Offline> {
    cfg.pairing.as_ref()?;
    let exe = paths::for_config().map(|p| p.display().to_string()).unwrap_or_else(paths::file_name);
    Some(Offline::Unpaired { pair_cmd: format!("{} pair", register::shell_quote(&exe)) })
}

/// La IA llamó a «sshorus_emparejar»: se vuelve a mirar el llavero (quizá ya se emparejó).
fn check_paired(cfg: &BridgeConfig, shared: &SharedRef, id: &Value, off: &Offline) -> Vec<String> {
    match cfg.pairing.as_ref().and_then(PairLookup::load) {
        Some(token) => {
            lock(shared).token = Some(token);
            vec![
                tool_text(id, "Emparejado con SSHorus: vuelve a pedir la lista de herramientas (tools/list).", false),
                list_changed(),
            ]
        }
        None => vec![tool_text(id, &off.message(), true)],
    }
}

fn list_changed() -> String {
    json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }).to_string()
}

/// Cuando la app se abra, avisa al cliente de que cambió la lista de herramientas.
fn watch_for_app(cfg: Arc<BridgeConfig>, shared: SharedRef, tx: mpsc::UnboundedSender<String>) {
    {
        let mut s = lock(&shared);
        if s.watching {
            return;
        }
        s.watching = true;
    }
    // Referencia débil: si el cliente cierra la entrada, el puente termina sin esperar a la app.
    let tx = tx.downgrade();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(cfg.poll).await;
            let Some(sender) = tx.upgrade() else { break };
            if app_is_open(cfg.port).await {
                let _ = sender.send(list_changed());
                break;
            }
        }
        lock(&shared).watching = false;
    });
}

async fn app_is_open(port: u16) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(("127.0.0.1", port))).await,
        Ok(Ok(_))
    )
}
