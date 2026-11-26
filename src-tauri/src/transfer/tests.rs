//! Pruebas en vivo contra el servidor de pruebas (las unitarias están en `paths.rs`).
//!
//! cargo test --lib transfer -- --ignored --test-threads=1 --nocapture

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::BoxFuture;

use super::engine::{Engine, TransferEnv, CLOSED_MSG, WAITING_MSG};
use super::policy::{Conflict, ConflictQuestion, ASK_MSG};
use crate::error::{AppError, AppResult};
use crate::ssh::connect::testutil::connect_test_server;
use crate::ssh::SshSession;
use crate::types::{TransferJob, TransferStatus};

struct TestEnv {
    /// Alias → conexión (se puede cambiar para simular reconexiones).
    sessions: Mutex<HashMap<String, Arc<SshSession>>>,
    concurrency: AtomicUsize,
    policy: Mutex<Conflict>,
    auto_reconnect: AtomicBool,
    updates: Mutex<Vec<TransferJob>>,
    removed: Mutex<Vec<String>>,
    questions: Mutex<Vec<ConflictQuestion>>,
    answered: Mutex<Vec<String>>,
}

impl TransferEnv for TestEnv {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>> {
        Box::pin(async move {
            match self.sessions.lock().unwrap().get(id) {
                Some(s) if !s.is_closed() => Ok(s.clone()),
                _ => Err(AppError::SessionNotFound(id.into())),
            }
        })
    }
    fn concurrency(&self) -> usize {
        self.concurrency.load(Ordering::Relaxed)
    }
    fn conflict_policy(&self) -> Conflict {
        *self.policy.lock().unwrap()
    }
    fn auto_reconnect(&self) -> bool {
        self.auto_reconnect.load(Ordering::Relaxed)
    }
    fn emit_update(&self, jobs: Vec<TransferJob>) {
        self.updates.lock().unwrap().extend(jobs);
    }
    fn emit_removed(&self, ids: Vec<String>) {
        self.removed.lock().unwrap().extend(ids);
    }
    fn emit_conflict(&self, question: ConflictQuestion) {
        self.questions.lock().unwrap().push(question);
    }
    fn emit_conflict_done(&self, job_ids: Vec<String>) {
        self.answered.lock().unwrap().extend(job_ids);
    }
}

async fn setup(concurrency: usize) -> (Arc<Engine>, Arc<TestEnv>, Arc<SshSession>) {
    let session = connect_test_server().await;
    let env = Arc::new(TestEnv {
        sessions: Mutex::new(HashMap::from([(session.info.id.clone(), session.clone())])),
        concurrency: AtomicUsize::new(concurrency),
        policy: Mutex::new(Conflict::Overwrite),
        auto_reconnect: AtomicBool::new(true),
        updates: Mutex::new(Vec::new()),
        removed: Mutex::new(Vec::new()),
        questions: Mutex::new(Vec::new()),
        answered: Mutex::new(Vec::new()),
    });
    (Engine::new(env.clone()), env, session)
}

/// Ejecuta un comando en el servidor (para limpiar).
async fn remote_exec(session: &SshSession, cmd: &str) {
    let mut ch = session.open_channel().await.unwrap();
    ch.exec(true, cmd).await.unwrap();
    while let Some(msg) = ch.wait().await {
        if let russh::ChannelMsg::ExitStatus { .. } = msg {
            break;
        }
    }
}

/// Datos pseudoaleatorios reproducibles (xorshift).
fn pseudo_bytes(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut out = Vec::with_capacity(len + 8);
    while out.len() < len {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.extend_from_slice(&x.to_le_bytes());
    }
    out.truncate(len);
    out
}

fn tmp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sshorus-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

async fn wait_batch(engine: &Engine, batch: &str, limit: Duration) {
    let t0 = Instant::now();
    loop {
        if engine.batch_finished(batch) {
            return;
        }
        assert!(t0.elapsed() < limit, "el lote {batch} no terminó a tiempo");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn batch_jobs(engine: &Engine, batch: &str) -> Vec<TransferJob> {
    engine.list().into_iter().filter(|j| j.batch_id == batch).collect()
}

fn assert_all_done(engine: &Engine, batch: &str) -> (usize, u64) {
    let jobs = batch_jobs(engine, batch);
    let bad: Vec<_> = jobs
        .iter()
        .filter(|j| j.status != TransferStatus::Done)
        .map(|j| format!("{} {:?} {:?}", j.name, j.status, j.error))
        .collect();
    assert!(bad.is_empty(), "trabajos sin terminar: {bad:?}");
    (jobs.len(), jobs.iter().map(|j| j.size).sum())
}

/// Compara dos árboles: mismos archivos, mismos bytes y mismas carpetas (también vacías).
fn assert_same_tree(a: &Path, b: &Path) {
    let list = |root: &Path| -> Vec<(String, bool)> {
        let mut v: Vec<(String, bool)> = walkdir::WalkDir::new(root)
            .min_depth(1)
            .into_iter()
            .map(|e| e.unwrap())
            .map(|e| {
                let rel = e.path().strip_prefix(root).unwrap().to_string_lossy().into_owned();
                (rel, e.file_type().is_dir())
            })
            .collect();
        v.sort();
        v
    };
    let la = list(a);
    let lb = list(b);
    assert_eq!(la, lb, "los árboles difieren");
    for (rel, is_dir) in la {
        if !is_dir {
            let x = std::fs::read(a.join(&rel)).unwrap();
            let y = std::fs::read(b.join(&rel)).unwrap();
            assert!(x == y, "contenido distinto en {rel}");
        }
    }
}

fn mbps(bytes: u64, d: Duration) -> f64 {
    bytes as f64 / 1_048_576.0 / d.as_secs_f64().max(1e-6)
}

/// Espera a que un trabajo pase de `min` bytes (o termine).
async fn wait_progress(engine: &Engine, batch: &str, min: u64) -> TransferJob {
    let t0 = Instant::now();
    loop {
        if let Some(j) = batch_jobs(engine, batch).into_iter().next()
            && (j.transferred >= min || j.status == TransferStatus::Done) {
                return j;
            }
        assert!(t0.elapsed() < Duration::from_secs(60), "sin progreso");
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

// ───────────────────────── Ronda 2: conflictos, enlaces, concurrencia, reconexión ─────────────────────────

/// Ejecuta un comando remoto y devuelve su salida estándar.
async fn remote_out(session: &SshSession, cmd: &str) -> String {
    let mut ch = session.open_channel().await.unwrap();
    ch.exec(true, cmd).await.unwrap();
    let mut out = Vec::new();
    while let Some(msg) = ch.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => out.extend_from_slice(&data),
            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
            _ => {}
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn set_mtime(path: &Path, secs_ago: u64) {
    let t = std::time::SystemTime::now() - Duration::from_secs(secs_ago);
    std::fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
}

fn status_of(engine: &Engine, batch: &str, name: &str) -> (TransferStatus, Option<String>) {
    let j = batch_jobs(engine, batch)
        .into_iter()
        .find(|j| j.name == name)
        .unwrap_or_else(|| panic!("no hay trabajo {name}"));
    (j.status, j.error)
}

async fn wait_until(limit: Duration, mut f: impl FnMut() -> bool) -> bool {
    let t0 = Instant::now();
    while t0.elapsed() < limit {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    f()
}

#[path = "tests_roundtrip.rs"]
mod roundtrip_flow;

#[path = "tests_conflicts.rs"]
mod conflicts_flow;

#[path = "tests_session.rs"]
mod session_flow;
