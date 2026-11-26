//! Pruebas del escáner con salidas REALES capturadas el 12/11/2026 (carpeta `fixtures/`, ver
//! PENDIENTES 10.13) y una OSV falsa en memoria. Las que hablan con OSV de verdad, con contenedores o
//! con el servidor de pruebas están en `live_tests.rs` (`#[ignore]`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::analyze::analyze;
use super::cache::OsvCache;
use super::plan::{plan_from, select_images};
use super::ecosystem;
use super::export;
use super::model::*;
use super::osv::{self, BatchItem, Hit, OsvApi, OsvError, OsvVuln, Query};
use super::parse::{self, apk, debsecan, dnf, dpkg, inventory, osrelease, rpm, trivy, ubuntu_pro, zypper};
use super::scripts;
use super::severity;
use super::store::History;

macro_rules! fx {
    ($name:literal) => {
        include_str!(concat!("fixtures/", $name))
    };
}

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("sshorus-vulnscan-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn no_progress() -> impl Fn(&str, usize, usize, &str) + Send + Sync {
    |_: &str, _: usize, _: usize, _: &str| {}
}

// ───────────── Avisos de OSV (respuestas reales) ─────────────

fn vuln(name: &str) -> OsvVuln {
    let text = match name {
        "DSA-5863-1" => fx!("osv/DSA-5863-1.json"),
        "DEBIAN-CVE-2023-45853" => fx!("osv/DEBIAN-CVE-2023-45853.json"),
        "ALPINE-CVE-2023-2650" => fx!("osv/ALPINE-CVE-2023-2650.json"),
        "RLSA-2022:6157" => fx!("osv/RLSA-2022_6157.json"),
        "UBUNTU-CVE-2023-50495" => fx!("osv/UBUNTU-CVE-2023-50495.json"),
        "ALSA-2023:0333" => fx!("osv/ALSA-2023_0333.json"),
        "CVE-2023-2650" => fx!("osv/CVE-2023-2650.json"),
        _ => panic!("sin fixture {name}"),
    };
    serde_json::from_str(text).unwrap()
}

// ───────────── OSV falsa: lotes, páginas, ecosistemas inválidos, caché ─────────────

#[derive(Default)]
struct FakeOsv {
    /// (ecosistema, nombre, versión) → ids. Si hay más de `page` ids, se paginan.
    db: HashMap<(String, String), Vec<String>>,
    page: usize,
    bad_ecosystems: Vec<String>,
    vulns: HashMap<String, Value>,
    batch_calls: AtomicUsize,
    batch_sizes: Mutex<Vec<usize>>,
    vuln_calls: AtomicUsize,
}

impl OsvApi for FakeOsv {
    async fn querybatch(&self, queries: &[(Query, Option<String>)]) -> Result<Vec<BatchItem>, OsvError> {
        self.batch_calls.fetch_add(1, Ordering::SeqCst);
        self.batch_sizes.lock().unwrap().push(queries.len());
        if queries.len() > osv::MAX_BATCH {
            return Err(OsvError::BadRequest("too many queries".into()));
        }
        if queries.iter().any(|(q, _)| self.bad_ecosystems.contains(&q.ecosystem)) {
            return Err(OsvError::BadRequest("invalid ecosystem".into()));
        }
        Ok(queries
            .iter()
            .map(|(q, tok)| {
                let all = self.db.get(&(q.ecosystem.clone(), q.name.clone())).cloned().unwrap_or_default();
                let start: usize = tok.as_deref().map(|t| t.parse().unwrap()).unwrap_or(0);
                let page = if self.page == 0 { usize::MAX } else { self.page };
                let end = all.len().min(start.saturating_add(page));
                BatchItem {
                    vulns: all[start..end].iter().map(|id| Hit { id: id.clone(), modified: "2026-01-01T00:00:00Z".into() }).collect(),
                    next_page_token: (end < all.len()).then(|| end.to_string()),
                }
            })
            .collect())
    }

    async fn vuln(&self, id: &str) -> Result<Value, OsvError> {
        self.vuln_calls.fetch_add(1, Ordering::SeqCst);
        self.vulns.get(id).cloned().ok_or(OsvError::NotFound)
    }
}

fn q(eco: &str, name: &str) -> Query {
    Query { ecosystem: eco.into(), name: name.into(), version: "1".into() }
}

fn os(text: &str) -> OsRelease {
    osrelease::parse(text)
}

#[path = "tests_parse.rs"]
mod parse_flow;

#[path = "tests_scripts.rs"]
mod scripts_flow;

#[path = "tests_osv.rs"]
mod osv_flow;

#[path = "tests_analyze.rs"]
mod analyze_flow;
