//! Pruebas de la lógica del MCP con un motor simulado (sin Tauri ni red SSH):
//! permisos, aprobación, bloqueo, token, comandos peligrosos, límites de salida, registro,
//! transporte HTTP y puente stdio.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use super::approval::{ApprovalRequest, Decision};
use super::audit::{AuditLog, AuditStatus};
use super::backend::Backend;
use super::config::{McpConfig, McpConfigStore};
use super::core::{CatalogEntry, McpCore, ToolOutput, DISABLED_MSG, LOCKED_MSG};
use super::policy::{self, Access, Action, Verdict};
use super::vuln::fixtures as vuln_fixtures;
use super::{bridge, diff, http, template};
use crate::error::{AppError, AppResult};
use crate::sftp::FilePart;
use crate::types::{
    AuthMethod, ExecResult, FileEntry, FileKind, ProfilesData, Project, ServerProfile, SessionInfo, Snippet,
    TransferJob,
};
use crate::vulnscan::model::{Report, Severity};
use crate::vulnscan::scan::ScanOptions;
use crate::vulnscan::VulnScanSettings;

// ───────────────────────── Motor simulado ─────────────────────────

#[derive(Clone, Copy)]
enum Answer {
    Give(Decision),
    /// Nadie responde (para el tiempo límite).
    Never,
}

struct Mock {
    locked: AtomicBool,
    /// Se bloquea SSHorus justo al preguntar (bloqueo mientras se espera la respuesta).
    lock_on_ask: AtomicBool,
    data: ProfilesData,
    sessions: Vec<SessionInfo>,
    answer: Mutex<Answer>,
    asked: Mutex<Vec<ApprovalRequest>>,
    ran: Mutex<Vec<String>>,
    stdout: Mutex<String>,
    files: Mutex<HashMap<String, String>>,
    ui_calls: Mutex<Vec<String>>,
    /// Escáner: ajustes, último informe guardado, cuánto tarda un análisis y lo que se pidió.
    vuln_settings: Mutex<VulnScanSettings>,
    vuln_saved: Mutex<HashMap<String, Report>>,
    audit_saved: Mutex<HashMap<String, crate::audit::model::AuditReport>>,
    scan_takes: Mutex<Duration>,
    scans: Mutex<Vec<(String, ScanOptions)>>,
    /// Análisis en curso por exec_id (para `cancel_exec`, el «Detener» del panel).
    scan_stops: Mutex<HashMap<String, CancellationToken>>,
    /// stdin de cada ejecución (None = sin stdin).
    stdins: Mutex<Vec<Option<Vec<u8>>>>,
    /// Respuesta de la interfaz a «sudo» y peticiones recibidas (tipo, payload).
    sudo_reply: Mutex<Value>,
    ui_payloads: Mutex<Vec<(String, Value)>>,
    /// Resultado fijo de exec (si no, stdout de `stdout` con código 0).
    exec_result: Mutex<Option<ExecResult>>,
    /// Ejecutar de verdad con `sh` en este equipo, con un sudo simulado (ver `FakeSudo`).
    local: Mutex<Option<FakeSudo>>,
    /// Se bloquea SSHorus mientras se busca la contraseña de sudo.
    lock_on_sudo: AtomicBool,
    /// La interfaz tarda 10 s en dar la contraseña de sudo (diálogo abierto).
    sudo_delay: AtomicBool,
    /// Enlaces simbólicos del servidor simulado (ruta → destino) para `realpath`.
    links: Mutex<HashMap<String, String>>,
    /// Llamadas a `expect_reboot` (session_id, wait_secs).
    reboot_expects: Mutex<Vec<(String, u32)>>,
    /// `run_with_password`: contraseñas guardadas, respuestas a sus diálogos y el terminal simulado.
    password: password_flow::MockPasswords,
}

fn server(id: &str, name: &str) -> ServerProfile {
    ServerProfile {
        id: id.into(),
        name: name.into(),
        host: format!("{name}.ejemplo"),
        port: 22,
        username: "deploy".into(),
        auth: AuthMethod::Password,
        key_path: None,
        default_path: None,
        color: None,
        tmux: None,
        sudo_mode: Default::default(),
    }
}

fn session(id: &str, profile: &str) -> SessionInfo {
    SessionInfo {
        id: id.into(),
        profile_id: profile.into(),
        name: profile.into(),
        host: "h".into(),
        port: 22,
        username: "deploy".into(),
        connected_at: 1,
    }
}

impl Mock {
    fn new() -> Self {
        Mock {
            locked: AtomicBool::new(false),
            lock_on_ask: AtomicBool::new(false),
            data: ProfilesData {
                servers: vec![server("s-full", "web-prod"), server("s-read", "db-server"), server("s-none", "vps-personal")],
                projects: vec![Project {
                    id: "p1".into(),
                    name: "Cliente X".into(),
                    server_ids: vec!["s-full".into(), "s-none".into()],
                    bookmarks: vec![],
                    color: None,
                }],
            },
            sessions: vec![session("ss-full", "s-full"), session("ss-read", "s-read"), session("ss-none", "s-none")],
            answer: Mutex::new(Answer::Give(Decision::Once)),
            asked: Mutex::new(Vec::new()),
            ran: Mutex::new(Vec::new()),
            stdout: Mutex::new("hola\n".into()),
            files: Mutex::new(HashMap::new()),
            ui_calls: Mutex::new(Vec::new()),
            vuln_settings: Mutex::new(VulnScanSettings::default()),
            vuln_saved: Mutex::new(HashMap::new()),
            audit_saved: Mutex::new(HashMap::new()),
            scan_takes: Mutex::new(Duration::from_secs(5)),
            scans: Mutex::new(Vec::new()),
            scan_stops: Mutex::new(HashMap::new()),
            stdins: Mutex::new(Vec::new()),
            sudo_reply: Mutex::new(json!({ "elevate": false })),
            ui_payloads: Mutex::new(Vec::new()),
            exec_result: Mutex::new(None),
            local: Mutex::new(None),
            lock_on_sudo: AtomicBool::new(false),
            sudo_delay: AtomicBool::new(false),
            links: Mutex::new(HashMap::new()),
            reboot_expects: Mutex::new(Vec::new()),
            password: Default::default(),
        }
    }
}

fn entry(path: &str, size: u64) -> FileEntry {
    FileEntry {
        name: path.rsplit('/').next().unwrap_or("").into(),
        path: path.into(),
        kind: FileKind::File,
        is_dir_link: false,
        size,
        modified: None,
        permissions: Some(0o644),
        permissions_str: "-rw-r--r--".into(),
        uid: None,
        gid: None,
    }
}

impl Backend for Mock {
    fn vault_locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }
    fn profiles(&self) -> ProfilesData {
        self.data.clone()
    }
    async fn sessions(&self) -> Vec<SessionInfo> {
        self.sessions.clone()
    }
    async fn exec(&self, _sid: &str, command: &str, stdin: Option<&[u8]>, _t: u32, _id: &str) -> AppResult<ExecResult> {
        self.ran.lock().unwrap().push(command.to_string());
        self.stdins.lock().unwrap().push(stdin.map(<[u8]>::to_vec));
        let local = self.local.lock().unwrap().clone();
        if let Some(fake) = local {
            return Ok(fake.run(command, stdin));
        }
        if let Some(r) = self.exec_result.lock().unwrap().clone() {
            return Ok(r);
        }
        Ok(ExecResult {
            stdout: self.stdout.lock().unwrap().clone(),
            stderr: String::new(),
            exit_code: Some(0),
            duration_ms: 5,
            truncated: false,
            timed_out: false,
        })
    }
    async fn run_pty(
        &self,
        _sid: &str,
        command: &str,
        opts: crate::mcp::pty_run::PtyOptions,
        _id: &str,
        prompts: tokio::sync::mpsc::Sender<crate::mcp::pty_run::PromptAsk>,
    ) -> AppResult<crate::mcp::pty_run::PtyOutcome> {
        self.password.run(command, opts, prompts).await
    }
    async fn saved_password(&self, _p: &str, _sid: &str, kind: super::backend::SavedPassword) -> AppResult<Option<Zeroizing<String>>> {
        Ok(self.password.saved(kind))
    }
    fn cancel_exec(&self, id: &str) -> bool {
        match self.scan_stops.lock().unwrap().get(id) {
            Some(t) => {
                t.cancel();
                true
            }
            None => false,
        }
    }
    async fn list_dir(&self, _sid: &str, path: &str) -> AppResult<Vec<FileEntry>> {
        Ok(vec![entry(&format!("{path}/a.txt"), 3)])
    }
    async fn stat(&self, _sid: &str, path: &str) -> AppResult<FileEntry> {
        Ok(entry(path, 3))
    }
    async fn read_part(&self, _sid: &str, path: &str, offset: u64, max: u64) -> AppResult<FilePart> {
        let files = self.files.lock().unwrap();
        let text = files.get(path).ok_or_else(|| AppError::NotFound(path.into()))?;
        let bytes = text.as_bytes();
        let start = (offset as usize).min(bytes.len());
        let end = (start + max as usize).min(bytes.len());
        Ok(FilePart { path: path.into(), size: bytes.len() as u64, offset, data: bytes[start..end].to_vec() })
    }
    async fn write_text(&self, _sid: &str, path: &str, content: &str) -> AppResult<FileEntry> {
        self.files.lock().unwrap().insert(path.into(), content.into());
        Ok(entry(path, content.len() as u64))
    }
    /// Como el servidor: relativa = desde /home/deploy; sigue los enlaces de `links` componente a componente
    /// (también los que aparecen tras «..»).
    async fn realpath(&self, _sid: &str, path: &str) -> AppResult<String> {
        let links = self.links.lock().unwrap().clone();
        let full = if path.starts_with('/') { path.to_string() } else { format!("/home/deploy/{path}") };
        let mut todo: Vec<String> = full.split('/').filter(|p| !p.is_empty()).map(str::to_string).rev().collect();
        let mut cur: Vec<String> = Vec::new();
        let mut hops = 0;
        while let Some(part) = todo.pop() {
            match part.as_str() {
                "." => {}
                ".." => {
                    cur.pop();
                }
                _ => {
                    cur.push(part);
                    let here = format!("/{}", cur.join("/"));
                    if let Some(target) = links.get(&here) {
                        hops += 1;
                        assert!(hops < 40, "bucle de enlaces");
                        cur.clear();
                        todo.extend(target.split('/').filter(|p| !p.is_empty()).map(str::to_string).rev());
                    }
                }
            }
        }
        Ok(format!("/{}", cur.join("/")))
    }
    async fn upload(&self, _sid: &str, _l: Vec<String>, _r: String) -> AppResult<String> {
        Ok("lote-1".into())
    }
    async fn download(&self, _sid: &str, _r: Vec<String>, _l: String) -> AppResult<String> {
        Ok("lote-2".into())
    }
    fn transfers(&self) -> Vec<TransferJob> {
        Vec::new()
    }
    fn snippets(&self) -> Vec<Snippet> {
        Vec::new()
    }
    fn vuln_settings(&self) -> VulnScanSettings {
        self.vuln_settings.lock().unwrap().clone()
    }
    async fn vuln_latest(&self, server_id: &str) -> AppResult<Option<Report>> {
        Ok(self.vuln_saved.lock().unwrap().get(server_id).cloned())
    }
    async fn audit_latest(&self, server_id: &str) -> AppResult<Option<crate::audit::model::AuditReport>> {
        Ok(self.audit_saved.lock().unwrap().get(server_id).cloned())
    }
    async fn vuln_scan(&self, sid: &str, opts: ScanOptions, exec_id: &str, cancel: &CancellationToken) -> AppResult<Report> {
        self.scans.lock().unwrap().push((sid.to_string(), opts.clone()));
        self.scan_stops.lock().unwrap().insert(exec_id.to_string(), cancel.clone());
        let takes = *self.scan_takes.lock().unwrap();
        let finished = tokio::select! {
            () = tokio::time::sleep(takes) => true,
            () = cancel.cancelled() => false,
        };
        self.scan_stops.lock().unwrap().remove(exec_id);
        if !finished {
            return Err(AppError::Canceled);
        }
        let mut r = vuln_fixtures::report(vec![
            vuln_fixtures::finding("CVE-2024-0001", Severity::Critical, true, Some(9.8)),
            vuln_fixtures::finding("CVE-2024-0002", Severity::Low, false, None),
        ]);
        r.server_id = opts.server_id.clone();
        r.summary.critical = 1;
        r.summary.low = 1;
        if opts.save {
            self.vuln_saved.lock().unwrap().insert(opts.server_id.clone(), r.clone());
        }
        Ok(r)
    }
    async fn expect_reboot(&self, sid: &str, wait_secs: u32) -> AppResult<u32> {
        self.reboot_expects.lock().unwrap().push((sid.to_string(), wait_secs));
        Ok(if wait_secs == 0 { 0 } else { 1 })
    }
    async fn ui_request(&self, kind: &str, payload: Value, _t: Duration) -> AppResult<Value> {
        self.ui_calls.lock().unwrap().push(kind.to_string());
        self.ui_payloads.lock().unwrap().push((kind.to_string(), payload));
        match kind {
            "connect" => Ok(json!({ "sessionId": "nueva" })),
            "sudo" | "sudo-reveal" => {
                if self.lock_on_sudo.load(Ordering::SeqCst) {
                    self.locked.store(true, Ordering::SeqCst);
                }
                if self.sudo_delay.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
                Ok(self.sudo_reply.lock().unwrap().clone())
            }
            "sudo-rejected" => Ok(Value::Null),
            "password-run" | "password-prompt" => Ok(self.password.reply()),
            "ports" => Ok(json!({ "tool": "ss", "ports": [{ "port": 22 }] })),
            "audit" => Ok(serde_json::to_value(audit_fixture()).unwrap()),
            "db-schema" => Ok(db_schema_flow::fixture()),
            _ => Err(AppError::Invalid("no disponible".into())),
        }
    }
    async fn ask_approval(&self, req: ApprovalRequest) -> Decision {
        self.asked.lock().unwrap().push(req);
        if self.lock_on_ask.load(Ordering::SeqCst) {
            self.locked.store(true, Ordering::SeqCst);
        }
        let answer = *self.answer.lock().unwrap();
        match answer {
            Answer::Give(d) => d,
            Answer::Never => std::future::pending().await,
        }
    }
    fn approval_done(&self, _id: &str) {}
}

fn config() -> McpConfig {
    let mut c = McpConfig { enabled: true, ..Default::default() };
    c.access.insert("s-full".into(), Access::Full);
    c.access.insert("s-read".into(), Access::Read);
    c
}

fn core_with(mock: Mock, cfg: McpConfig) -> McpCore<Mock> {
    let core = McpCore::new(mock, McpConfigStore::in_memory(cfg), AuditLog::at(None));
    core.set_catalog(vec![
        CatalogEntry {
            id: "podman.ps".into(),
            category: "Podman".into(),
            name: "Contenedores".into(),
            description: None,
            command: "podman ps -a".into(),
            dangerous: false,
            sudo: false,
            read_only: true,
            interactive: false,
            perm: None,
            scope: None,
        },
        CatalogEntry {
            id: "podman.logs".into(),
            category: "Podman".into(),
            name: "Logs".into(),
            description: None,
            command: "podman logs --tail {{lineas:100}} {{contenedor}}".into(),
            dangerous: false,
            sudo: false,
            read_only: true,
            interactive: false,
            perm: None,
            scope: None,
        },
        CatalogEntry {
            id: "podman.restart".into(),
            category: "Podman".into(),
            name: "Reiniciar".into(),
            description: None,
            command: "podman restart {{contenedor}}".into(),
            dangerous: false,
            sudo: false,
            read_only: false,
            interactive: false,
            perm: None,
            scope: None,
        },
        CatalogEntry {
            id: "podman.prune".into(),
            category: "Podman".into(),
            name: "Limpiar".into(),
            description: None,
            command: "podman system prune -f".into(),
            dangerous: true,
            sudo: false,
            read_only: false,
            interactive: false,
            perm: None,
            scope: None,
        },
    ]);
    core
}

fn core() -> McpCore<Mock> {
    core_with(Mock::new(), config())
}

async fn call(core: &McpCore<Mock>, tool: &str, args: Value) -> ToolOutput {
    core.call(tool, args, Some("prueba".into()), CancellationToken::new()).await
}

fn asked(core: &McpCore<Mock>) -> usize {
    core.backend.asked.lock().unwrap().len()
}

fn ran(core: &McpCore<Mock>) -> Vec<String> {
    core.backend.ran.lock().unwrap().clone()
}

fn set_answer(core: &McpCore<Mock>, a: Answer) {
    *core.backend.answer.lock().unwrap() = a;
}

// ───────────────────────── Transporte HTTP ─────────────────────────

struct TestGate {
    locked: AtomicBool,
    token: Option<String>,
}

impl http::Gate for TestGate {
    fn locked(&self) -> bool {
        self.locked.load(Ordering::SeqCst)
    }
    fn token(&self) -> Option<Zeroizing<String>> {
        self.token.clone().map(Zeroizing::new)
    }
}

const TOKEN: &str = "tv_prueba";

/// Servidor HTTP con el motor simulado en un puerto libre.
async fn spawn_http(gate: Arc<TestGate>) -> (u16, Arc<McpCore<Mock>>, CancellationToken) {
    let core = Arc::new(core());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let ct = CancellationToken::new();
    tokio::spawn(http::serve(listener, core.clone(), gate, ct.clone()));
    (port, core, ct)
}

fn gate(locked: bool) -> Arc<TestGate> {
    Arc::new(TestGate { locked: AtomicBool::new(locked), token: Some(TOKEN.into()) })
}

const INIT: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"prueba","version":"1"}}}"#;

async fn post(port: u16, body: &str, token: Option<&str>, origin: bool) -> (u16, String) {
    let mut req = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/mcp"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(body.to_string());
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    if origin {
        req = req.header("Origin", "https://malicioso.ejemplo");
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    (status, r.text().await.unwrap())
}

// ───────────────────────── Puente stdio ─────────────────────────

/// Lanza el puente con tuberías en memoria. Devuelve (escritor de stdin, lector de stdout).
fn spawn_bridge(port: u16, token: Option<&str>) -> (tokio::io::DuplexStream, tokio::io::Lines<BufReader<tokio::io::DuplexStream>>) {
    spawn_bridge_with(bridge::BridgeConfig {
        port,
        token: token.map(str::to_string),
        version: "0.0.0".into(),
        poll: Duration::from_millis(50),
        pairing: None,
    })
}

fn spawn_bridge_with(cfg: bridge::BridgeConfig) -> (tokio::io::DuplexStream, tokio::io::Lines<BufReader<tokio::io::DuplexStream>>) {
    let (client_in, bridge_in) = tokio::io::duplex(1 << 20);
    let (bridge_out, client_out) = tokio::io::duplex(1 << 20);
    tokio::spawn(bridge::run(cfg, BufReader::new(bridge_in), bridge_out));
    (client_in, BufReader::new(client_out).lines())
}

async fn send(w: &mut tokio::io::DuplexStream, msg: &str) {
    w.write_all(msg.as_bytes()).await.unwrap();
    w.write_all(b"\n").await.unwrap();
}

async fn recv(r: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(10), r.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&line).unwrap()
}

// ───────────────────────── sudo con contraseña ─────────────────────────

/// sudo simulado en una carpeta temporal de este equipo: el envoltorio de `sudo.rs` se prueba con un `sh`
/// de verdad. Acepta la contraseña de `<dir>/pw` por `-S` o por el askpass (`-A`), apunta cada intento en
/// `<dir>/log` («ok S», «ok A», «bad S»…) y, como no es root de verdad, `whoami` responde «root».
#[derive(Clone)]
struct FakeSudo(Arc<FakeDir>);

struct FakeDir(std::path::PathBuf);

impl Drop for FakeDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) const FAKE_SUDO: &str = r#"#!/bin/sh
ask=0 std=0 val=0 non=0
while [ $# -gt 0 ]; do
  case $1 in
    -A) ask=1 ;; -S) std=1 ;; -n) non=1 ;; -k) ;; -v) val=1 ;;
    -p|-u) shift ;;
    --) shift; break ;;
    -*) ;;
    *) break ;;
  esac
  shift
done
if [ $std = 1 ] && [ $ask = 1 ]; then echo "sudo: the -A and -S options may not be used together" >&2; exit 1; fi
if [ $std = 1 ]; then IFS= read -r pw || pw=; how=S
elif [ $ask = 1 ]; then pw=$("$SUDO_ASKPASS" "[sudo] password: "); how=A
elif [ $non = 1 ]; then echo "sudo: a password is required" >&2; exit 1
else
  echo "sudo: a terminal is required to read the password; either use ssh's -t option or configure an askpass helper" >&2
  echo "sudo: a password is required" >&2; exit 1
fi
if [ "$pw" != "$(cat "$TV_FAKE_DIR/pw")" ]; then
  echo "bad $how" >> "$TV_FAKE_DIR/log"; echo "Sorry, try again." >&2; echo "sudo: 1 incorrect password attempt" >&2; exit 1
fi
echo "ok $how" >> "$TV_FAKE_DIR/log"
[ $val = 1 ] && exit 0
[ $# -gt 0 ] || exit 0
case $1 in
  whoami) echo root; exit 0 ;;
  useradd) shift; echo "useradd $*"; exit 0 ;;
esac
exec "$@"
"#;

pub(super) const SUDO_PW: &str = "s3cr3t o'k \"$x\" \\n";

impl FakeSudo {
    fn new(password: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("sshorus-fakesudo-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        std::fs::create_dir_all(dir.join("run")).unwrap();
        std::fs::create_dir_all(dir.join("work")).unwrap();
        std::fs::write(dir.join("pw"), password).unwrap();
        let sudo = dir.join("bin").join("sudo");
        std::fs::write(&sudo, FAKE_SUDO).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sudo, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        FakeSudo(Arc::new(FakeDir(dir)))
    }

    fn dir(&self) -> &std::path::Path {
        &self.0 .0
    }

    fn work(&self) -> String {
        self.dir().join("work").display().to_string()
    }

    fn log(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir().join("log")).unwrap_or_default().lines().map(str::to_string).collect()
    }

    /// Lo que quedó en la carpeta temporal (XDG_RUNTIME_DIR) del envoltorio: debe quedar vacía.
    fn leftovers(&self) -> Vec<String> {
        std::fs::read_dir(self.dir().join("run"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }

    /// Ejecuta como el canal exec tras el arranque: `sh -c COMANDO` con `stdin` (y EOF).
    fn run(&self, command: &str, stdin: Option<&[u8]>) -> ExecResult {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let started = std::time::Instant::now();
        let path = format!("{}:{}", self.dir().join("bin").display(), std::env::var("PATH").unwrap_or_default());
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(command)
            .env("PATH", path)
            .env("SHELL", "/bin/sh")
            .env("XDG_RUNTIME_DIR", self.dir().join("run"))
            .env("TV_FAKE_DIR", self.dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let data = stdin.map(<[u8]>::to_vec).unwrap_or_default();
        let mut input = child.stdin.take().unwrap();
        let writer = std::thread::spawn(move || {
            let _ = input.write_all(&data);
        });
        let out = child.wait_with_output().unwrap();
        writer.join().unwrap();
        ExecResult {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code().map(|c| c as u32),
            duration_ms: started.elapsed().as_millis() as u64,
            truncated: false,
            timed_out: false,
        }
    }

    fn run_wrapped(&self, command: &str, password: &str) -> ExecResult {
        let w = super::sudo::wrap(command, password).unwrap();
        self.run(&w.command, Some(&w.stdin))
    }
}

fn ui_kinds(core: &McpCore<Mock>) -> Vec<String> {
    core.backend.ui_calls.lock().unwrap().clone()
}

// ───────────────────────── Aceptar automáticamente ─────────────────────────

use super::core::AutoDuration;
use super::policy::{AutoGrant, AutoLevel};
/// Auditoría de ejemplo (la usan el motor simulado y `tests_vuln.rs`).
fn audit_fixture() -> crate::audit::model::AuditReport {
    use crate::audit::model::*;
    let check = |id: &str, status: CheckStatus, weight: u8, items: usize| Check {
        id: id.into(),
        category: "ssh".into(),
        title: format!("título {id}"),
        status,
        detail: "detalle".into(),
        items: (0..items).map(|i| format!("elemento {i}")).collect(),
        fix: (status == CheckStatus::Bad).then(|| Fix { command: "echo arreglo".into(), danger: true, manual: false, note: None }),
        weight,
    };
    AuditReport {
        id: "a1".into(),
        server_id: "s-read".into(),
        created_at: "2026-11-13T10:00:00Z".into(),
        duration_ms: 1000,
        elevated: false,
        os: "Debian 12".into(),
        score: Some(64),
        grade: Some("D".into()),
        summary: "1 grave, 1 aviso".into(),
        categories: vec![CategoryScore { id: "ssh".into(), label: "SSH".into(), score: Some(40), grade: Some("F".into()), summary: "1 grave".into() }],
        checks: vec![
            check("ssh.keys", CheckStatus::Ok, 1, 0),
            check("ssh.password", CheckStatus::Warn, 2, 0),
            check("ssh.root", CheckStatus::Bad, 3, 25),
            check("hard.cron", CheckStatus::Skip, 1, 0),
        ],
        ai: None,
    }
}

#[path = "tests_sudo.rs"]
mod sudo_flow;

#[path = "tests_marked.rs"]
mod marked_flow;

#[path = "tests_reboot.rs"]
mod reboot_flow;

#[path = "tests_password.rs"]
mod password_flow;

#[path = "tests_pairing.rs"]
mod pairing_flow;

#[path = "tests_db_schema.rs"]
mod db_schema_flow;
#[path = "tests_oauth.rs"]
mod oauth_flow;

#[path = "tests_rules.rs"]
mod rules_flow;

#[path = "tests_approval.rs"]
mod approval_flow;

#[path = "tests_transport.rs"]
mod transport_flow;

#[path = "tests_vuln.rs"]
mod vuln_flow;

#[path = "tests_sudo_run.rs"]
mod sudo_run_flow;

#[path = "tests_auto.rs"]
mod auto_flow;

#[path = "tests_deploy.rs"]
mod deploy_flow;
