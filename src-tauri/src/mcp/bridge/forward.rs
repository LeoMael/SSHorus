//! Hablar con la app por HTTP local: reenviar un mensaje MCP (`/mcp`) y leer su respuesta (JSON o SSE).
//! `send` también lo usa `pair` para `/pair`.

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use serde_json::Value;
use tokio::net::TcpStream;

/// Qué pasó al reenviar.
pub enum Sent {
    /// Mensajes JSON-RPC de respuesta (ya en una línea cada uno).
    Messages(Vec<String>),
    /// La app no está abierta (no hay nadie en el puerto).
    Closed,
    /// La app respondió con un error HTTP (token incorrecto…).
    HttpError(String),
}

/// Lo que va en cada mensaje reenviado.
pub struct Outgoing<'a> {
    pub port: u16,
    pub token: &'a str,
    pub version: &'a str,
    /// Versión de protocolo acordada en `initialize`.
    pub protocol: Option<&'a str>,
    /// Nombre del cliente MCP (va en el User-Agent: queda en el registro de SSHorus).
    pub client: Option<&'a str>,
}

/// Envía una petición a `127.0.0.1:<port>`. None = no hay nadie escuchando (la app está cerrada).
pub async fn send(port: u16, req: http::Request<Full<Bytes>>) -> Option<http::Response<Incoming>> {
    let stream = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.ok()?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    sender.send_request(req).await.ok()
}

/// Mensaje de error de la app (`{"error": "…"}`) o el código HTTP.
pub async fn error_text(status: http::StatusCode, body: Incoming) -> String {
    let bytes = body.collect().await.map(|b| b.to_bytes()).unwrap_or_default();
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| format!("SSHorus respondió {status}"))
}

/// Envía un mensaje MCP a la app y devuelve lo que contestó.
pub async fn post(out: &Outgoing<'_>, body: String) -> Sent {
    let ua = match out.client {
        Some(c) => format!("sshorus-mcp/{} ({c})", out.version),
        None => format!("sshorus-mcp/{}", out.version),
    };
    let mut req = http::Request::builder()
        .method(http::Method::POST)
        .uri("/mcp")
        .header(http::header::HOST, format!("127.0.0.1:{}", out.port))
        .header(http::header::CONTENT_TYPE, "application/json")
        .header(http::header::ACCEPT, "application/json, text/event-stream")
        .header(http::header::AUTHORIZATION, format!("Bearer {}", out.token))
        .header(http::header::USER_AGENT, ua);
    if let Some(pv) = out.protocol {
        req = req.header("MCP-Protocol-Version", pv);
    }
    let req = match req.body(Full::new(Bytes::from(body))) {
        Ok(r) => r,
        Err(e) => return Sent::HttpError(format!("petición no válida: {e}")),
    };
    let Some(resp) = send(out.port, req).await else { return Sent::Closed };
    let status = resp.status();
    let is_sse = resp
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    let mut body = resp.into_body();
    if status == http::StatusCode::ACCEPTED {
        return Sent::Messages(Vec::new());
    }
    if !status.is_success() {
        return Sent::HttpError(error_text(status, body).await);
    }
    let mut out = Vec::new();
    if is_sse {
        let mut sse = SseParser::default();
        while let Some(frame) = body.frame().await {
            let Ok(frame) = frame else { break };
            if let Some(data) = frame.data_ref() {
                out.extend(sse.push(data));
            }
        }
        out.extend(sse.finish());
    } else {
        let bytes = body.collect().await.map(|b| b.to_bytes()).unwrap_or_default();
        if let Some(line) = one_line(&bytes) {
            out.push(line);
        }
    }
    Sent::Messages(out)
}

/// JSON en una sola línea (los mensajes por stdio van uno por línea).
fn one_line(bytes: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    Some(v.to_string())
}

/// Lector de eventos SSE: junta las líneas `data:` de cada evento.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    /// Añade bytes y devuelve los mensajes completos.
    pub fn push(&mut self, data: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(data);
        let mut out = Vec::new();
        // Se trabaja con bytes: un carácter UTF-8 puede llegar partido entre dos trozos.
        while let Some((end, next)) = Self::event_end(&self.buf) {
            let event = String::from_utf8_lossy(&self.buf[..end]).into_owned();
            self.buf.drain(..next);
            if let Some(m) = Self::event_data(&event) {
                out.push(m);
            }
        }
        out
    }

    /// Último evento sin línea en blanco al final.
    pub fn finish(&mut self) -> Vec<String> {
        let rest = std::mem::take(&mut self.buf);
        Self::event_data(String::from_utf8_lossy(&rest).trim_end()).into_iter().collect()
    }

    /// Fin del primer evento (línea en blanco, `\n\n` o `\n\r\n`): (fin del evento, inicio del resto).
    fn event_end(buf: &[u8]) -> Option<(usize, usize)> {
        buf.iter().enumerate().find_map(|(i, &b)| {
            if b != b'\n' {
                return None;
            }
            match (buf.get(i + 1), buf.get(i + 2)) {
                (Some(b'\n'), _) => Some((i, i + 2)),
                (Some(b'\r'), Some(b'\n')) => Some((i, i + 3)),
                _ => None,
            }
        })
    }

    fn event_data(event: &str) -> Option<String> {
        let data: Vec<&str> = event
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(|d| d.strip_prefix(' ').unwrap_or(d))
            .collect();
        if data.is_empty() {
            return None;
        }
        one_line(data.join("\n").as_bytes())
    }
}
