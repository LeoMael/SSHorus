//! Emparejado de punta a punta con el motor simulado: `sshorus-mcp pair` (su petición HTTP real) → tu
//! respuesta en el diálogo (simulada) → el puente usa el token de ese asistente con SUS permisos. También
//! rechazar, sin respuesta, límite de peticiones, bloqueo, revocar y el puente sin emparejar. El mismo
//! entorno (con OAuth) lo usan las pruebas de `tests_oauth.rs`.

use std::sync::atomic::AtomicUsize;

use super::*;
use crate::mcp::bridge::pair::{ask_app, AskError};
use crate::mcp::bridge::wire::{PairOutcome, PairReply, PairRequest};
use crate::mcp::bridge::{offline, PairLookup};
use crate::mcp::pairing::model::{ClientView, PairDecision, PairPrompt};
use crate::mcp::pairing::notify::PairNotifier;
use crate::mcp::oauth::directory::{Directory, StaticDocs};
use crate::mcp::oauth::OAuth;
use crate::mcp::pairing::registry::ClientRegistry;
use crate::mcp::pairing::Pairing;

/// Qué responde el «usuario» a cada asistente.
#[derive(Clone)]
pub(super) enum Reply {
    Accept(Vec<(&'static str, Access)>),
    Reject,
    /// No responde (vence).
    Ignore,
    /// SSHorus se bloquea antes de que llegue el «Aceptar».
    LockThenAccept,
}

struct ChanNotifier(tokio::sync::mpsc::UnboundedSender<PairPrompt>);

impl PairNotifier for ChanNotifier {
    fn show(&self, p: &PairPrompt) {
        let _ = self.0.send(p.clone());
    }
    fn done(&self, _: &str) {}
    fn changed(&self, _: &[ClientView]) {}
}

pub(super) struct PairGate {
    pub locked: AtomicBool,
    pub pairing: Arc<Pairing>,
    oauth: OAuth,
}

impl http::Gate for PairGate {
    fn locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }
    fn token(&self) -> Option<Zeroizing<String>> {
        Some(Zeroizing::new(TOKEN.into()))
    }
    fn pairing(&self) -> Option<&Pairing> {
        Some(&self.pairing)
    }
    fn oauth(&self) -> Option<&OAuth> {
        Some(&self.oauth)
    }
}

pub(super) struct Env {
    pub port: u16,
    pub core: Arc<McpCore<Mock>>,
    pub gate: Arc<PairGate>,
    /// Diálogos mostrados (y el último, para ver qué decía).
    pub shown: Arc<AtomicUsize>,
    pub last: Arc<Mutex<Option<PairPrompt>>>,
    pub ct: CancellationToken,
}

async fn start(replies: Vec<(&'static str, Reply)>) -> Env {
    start_with(replies, HashMap::new()).await
}

/// Servidor HTTP real con el motor simulado; el «usuario» responde a cada asistente según `replies`, y los
/// clientes OAuth con documento de metadatos se resuelven con `docs`.
pub(super) async fn start_with(replies: Vec<(&'static str, Reply)>, docs: HashMap<String, Vec<u8>>) -> Env {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PairPrompt>();
    let pairing =
        Arc::new(Pairing::new(ClientRegistry::at(None), Box::new(ChanNotifier(tx))).with_wait(Duration::from_millis(400)));
    let oauth = OAuth::new(pairing.clone(), Directory::new(Box::new(StaticDocs(docs)), None));
    let gate = Arc::new(PairGate { locked: AtomicBool::new(false), pairing, oauth });
    let shown = Arc::new(AtomicUsize::new(0));
    let last = Arc::new(Mutex::new(None));
    let seen = last.clone();
    let (g, count) = (gate.clone(), shown.clone());
    let replies: HashMap<&str, Reply> = replies.into_iter().collect();
    tokio::spawn(async move {
        while let Some(p) = rx.recv().await {
            count.fetch_add(1, Ordering::SeqCst);
            *seen.lock().unwrap() = Some(p.clone());
            let decision = match replies.get(p.client_id.as_str()).cloned().unwrap_or(Reply::Ignore) {
                Reply::Ignore => continue,
                Reply::Reject => PairDecision::reject(),
                Reply::Accept(a) => PairDecision { accept: true, access: a.iter().map(|(k, v)| (k.to_string(), *v)).collect() },
                Reply::LockThenAccept => {
                    g.locked.store(true, Ordering::SeqCst);
                    PairDecision { accept: true, access: BTreeMap::new() }
                }
            };
            g.pairing.reply(&p.id, decision);
        }
    });
    let core = Arc::new(core());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let ct = CancellationToken::new();
    let dyn_gate: Arc<dyn http::Gate> = gate.clone();
    tokio::spawn(http::serve(listener, core.clone(), dyn_gate, ct.clone()));
    Env { port, core, gate, shown, last, ct }
}

fn request(id: &str) -> PairRequest {
    PairRequest {
        client_id: id.into(),
        name: format!("Asistente {id}"),
        program: format!("{id} --continue"),
        pid: Some(4242),
        cwd: Some("/home/u/proyecto".into()),
        version: "0.0.0".into(),
    }
}

async fn pair(env: &Env, id: &str) -> PairReply {
    ask_app(env.port, &request(id)).await.unwrap()
}

/// `list_servers` por el puente con este token (initialize primero, como un cliente real).
async fn list_servers(port: u16, token: &str) -> Value {
    let (mut w, mut r) = spawn_bridge(port, Some(token));
    send(&mut w, INIT).await;
    recv(&mut r).await;
    send(&mut w, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).await;
    send(&mut w, r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_servers","arguments":{}}}"#).await;
    recv(&mut r).await
}

pub(super) fn names(v: &Value) -> Vec<String> {
    let text = v["result"]["content"][0]["text"].as_str().unwrap_or("[]");
    let list: Vec<Value> = serde_json::from_str(text).unwrap_or_default();
    list.iter().map(|s| s["name"].as_str().unwrap_or("").to_string()).collect()
}

#[tokio::test]
async fn pair_accept_and_each_assistant_uses_its_own_permissions() {
    let env = start(vec![
        ("claude", Reply::Accept(vec![("s-none", Access::Read)])),
        ("codex", Reply::Accept(vec![("s-full", Access::Full), ("s-read", Access::None)])),
    ])
    .await;
    let claude = pair(&env, "claude").await;
    assert_eq!(claude.outcome, PairOutcome::Accepted, "{}", claude.message);
    let claude_token = claude.token.clone().unwrap();
    assert!(claude_token.starts_with("tvc_"));
    assert_eq!(claude.servers.len(), 1);
    assert_eq!((claude.servers[0].name.as_str(), claude.servers[0].access.as_str()), ("vps-personal", "Solo lectura"));
    let codex_token = pair(&env, "codex").await.token.unwrap();

    // Cada uno ve lo suyo, aunque los permisos generales digan otra cosa.
    assert_eq!(names(&list_servers(env.port, &claude_token).await), vec!["vps-personal"]);
    assert_eq!(names(&list_servers(env.port, &codex_token).await), vec!["web-prod"]);
    // El token general sigue igual.
    assert_eq!(names(&list_servers(env.port, TOKEN).await), vec!["web-prod", "db-server"]);

    // El registro dice qué asistente fue; el emparejado también quedó anotado.
    let log = env.core.audit.list();
    assert!(log.iter().any(|e| e.tool == "list_servers" && e.client_id.as_deref() == Some("claude")));
    assert!(log.iter().any(|e| e.tool == "emparejar" && e.status == AuditStatus::Ok && e.client_id.as_deref() == Some("codex")));

    // Las reglas de aprobación siguen: Solo lectura no deja cambiar nada.
    let grant = match env.gate.pairing.authenticate(&claude_token, &env.core.audit) {
        crate::mcp::pairing::Auth::Client(g) => g,
        other => panic!("{other:?}"),
    };
    let out = env
        .core
        .call_as("run_command", json!({ "server": "vps-personal", "command": "touch x" }), None, crate::mcp::caller::Caller::paired(grant), CancellationToken::new())
        .await;
    assert!(out.is_error && out.text.contains("solo lectura"), "{}", out.text);

    // Revocar: ese token deja de valer al instante (el otro sigue) y el intento queda en el registro.
    env.gate.pairing.revoke("claude", &env.core.audit).unwrap();
    let (status, body) = post(env.port, INIT, Some(&claude_token), false).await;
    assert_eq!(status, 401);
    assert!(body.contains("ya no está emparejado"), "{body}");
    assert!(env.core.audit.list().iter().any(|e| e.tool == "emparejar: token revocado"));
    assert!(env.core.audit.list().iter().any(|e| e.tool == "emparejar: revocar"));
    assert_eq!(names(&list_servers(env.port, &codex_token).await), vec!["web-prod"]);
    env.ct.cancel();
}

#[tokio::test]
async fn pair_rejected_unanswered_and_rate_limited() {
    let env = start(vec![("gemini", Reply::Reject)]).await;
    let r = pair(&env, "gemini").await;
    assert_eq!((r.outcome, r.token.is_none()), (PairOutcome::Rejected, true));
    let r = pair(&env, "agy").await;
    assert_eq!(r.outcome, PairOutcome::Timeout);

    // Tercera del minuto: espera; otra del mismo asistente mientras tanto → 429 sin diálogo.
    let port = env.port;
    let waiting = tokio::spawn(async move { ask_app(port, &request("lento")).await.unwrap() });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(pair(&env, "lento").await.outcome, PairOutcome::Busy);
    // Una cuarta de otro asistente: también 429 (más de 3 por minuto).
    let r = pair(&env, "otro").await;
    assert_eq!(r.outcome, PairOutcome::Busy);
    assert_eq!(r.http_status(), 429);
    assert_eq!(waiting.await.unwrap().outcome, PairOutcome::Timeout);
    assert_eq!(env.shown.load(Ordering::SeqCst), 3, "solo se muestran las que pasan el límite");

    let denied: Vec<_> = env.core.audit.list().into_iter().filter(|e| e.tool == "emparejar").collect();
    assert_eq!(denied.len(), 3);
    assert!(denied.iter().all(|e| e.status == AuditStatus::Denied));
    assert!(env.gate.pairing.clients().is_empty());
    env.ct.cancel();
}

#[tokio::test]
async fn pair_refused_when_locked_invalid_or_from_a_web_page() {
    let env = start(vec![("lk", Reply::LockThenAccept)]).await;
    // Bloqueado al pedir: ni se pregunta.
    env.gate.locked.store(true, Ordering::SeqCst);
    assert_eq!(pair(&env, "claude").await.outcome, PairOutcome::Locked);
    assert_eq!(env.shown.load(Ordering::SeqCst), 0);
    env.gate.locked.store(false, Ordering::SeqCst);
    // Se bloquea mientras espera: aunque se acepte, no se empareja.
    assert_eq!(pair(&env, "lk").await.outcome, PairOutcome::Locked);
    assert!(env.gate.pairing.clients().is_empty());
    env.gate.locked.store(false, Ordering::SeqCst);

    let url = format!("http://127.0.0.1:{}/pair", env.port);
    let r = reqwest::Client::new().post(&url).body("no es json").send().await.unwrap();
    assert_eq!(r.status().as_u16(), 400);
    let r = reqwest::Client::new()
        .post(&url)
        .header("Origin", "https://malicioso.ejemplo")
        .body(serde_json::to_string(&request("claude")).unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 403);
    env.ct.cancel();

    // App cerrada: el puente lo dice claro.
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(ask_app(env.port, &request("claude")).await, Err(AskError::Closed));
}

#[tokio::test]
async fn bridge_without_token_asks_to_pair() {
    let env = start(vec![]).await;
    let (mut w, mut r) = spawn_bridge_with(bridge::BridgeConfig {
        port: env.port,
        token: None,
        version: "0.0.0".into(),
        poll: Duration::from_millis(50),
        pairing: Some(PairLookup { client_id: "claude".into(), service: "sshorus-test".into() }),
    });
    send(&mut w, INIT).await;
    let v = recv(&mut r).await;
    let instructions = v["result"]["instructions"].as_str().unwrap();
    assert!(instructions.contains("pair") && instructions.contains("no está emparejado"), "{instructions}");
    send(&mut w, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).await;
    let v = recv(&mut r).await;
    assert_eq!(v["result"]["tools"][0]["name"], offline::PAIR_TOOL);
    send(&mut w, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_servers","arguments":{}}}"#).await;
    let v = recv(&mut r).await;
    assert!(v["error"]["message"].as_str().unwrap().contains("pair"), "{v}");
    env.ct.cancel();
}
