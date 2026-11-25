//! Respuestas del puente cuando no puede reenviar a la app: SSHorus cerrado o asistente sin emparejar.
//!
//! En vez de fallar el arranque (el cliente MCP marcaría el servidor como roto y la IA no vería nada), el
//! puente contesta `initialize` él mismo y ofrece una sola herramienta que explica qué hacer. Así la IA
//! lee el motivo y puede resolverlo (abrir SSHorus o ejecutar `sshorus-mcp pair`).

use serde_json::{json, Value};

pub const CLOSED_MSG: &str = "Abre SSHorus para usar tus servidores.";
pub const CLOSED_TOOL: &str = "sshorus_abrir";
pub const PAIR_TOOL: &str = "sshorus_emparejar";
/// Versión de protocolo si el cliente no dice ninguna.
const FALLBACK_PROTOCOL: &str = "2025-06-18";

/// Por qué no se reenvía.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Offline {
    Closed,
    /// No hay token: `pair_cmd` es la orden exacta para emparejar.
    Unpaired { pair_cmd: String },
}

impl Offline {
    pub fn tool(&self) -> &'static str {
        match self {
            Offline::Closed => CLOSED_TOOL,
            Offline::Unpaired { .. } => PAIR_TOOL,
        }
    }

    /// Lo que hay que hacer, en una frase.
    pub fn message(&self) -> String {
        match self {
            Offline::Closed => CLOSED_MSG.to_string(),
            Offline::Unpaired { pair_cmd } => format!(
                "SSHorus aún no está emparejado con este asistente. Ejecuta en una terminal `{pair_cmd}` (sin \
                 secretos: el usuario lo acepta en SSHorus y elige los permisos) y después llama a {PAIR_TOOL}."
            ),
        }
    }

    fn instructions(&self) -> String {
        match self {
            Offline::Closed => format!("SSHorus está cerrado. {CLOSED_MSG} Las herramientas aparecerán solas cuando se abra."),
            Offline::Unpaired { .. } => self.message(),
        }
    }

    fn tool_description(&self) -> String {
        match self {
            Offline::Closed => format!("SSHorus está cerrado. {CLOSED_MSG} Llama a esta herramienta para comprobarlo de nuevo."),
            Offline::Unpaired { .. } => format!("{} Esta herramienta comprueba si ya se emparejó.", self.message()),
        }
    }
}

pub fn error_msg(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

pub fn result_msg(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// Resultado de herramienta con un texto.
pub fn tool_text(id: &Value, text: &str, is_error: bool) -> String {
    result_msg(id, json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
}

/// Respuesta a una petición (`id`) mientras no se puede reenviar.
pub fn reply(off: &Offline, id: &Value, method: &str, msg: &Value, version: &str) -> String {
    match method {
        "initialize" => {
            let pv = msg.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or(FALLBACK_PROTOCOL);
            result_msg(
                id,
                json!({
                    "protocolVersion": pv,
                    "capabilities": { "tools": { "listChanged": true } },
                    "serverInfo": { "name": "sshorus", "version": version },
                    "instructions": off.instructions(),
                }),
            )
        }
        "ping" => result_msg(id, json!({})),
        "tools/list" => result_msg(
            id,
            json!({ "tools": [{
                "name": off.tool(),
                "description": off.tool_description(),
                "inputSchema": { "type": "object", "properties": {} },
            }] }),
        ),
        _ => error_msg(id, -32000, &off.message()),
    }
}
