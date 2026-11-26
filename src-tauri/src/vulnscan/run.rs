//! Fases 5 y 6 del análisis (consultar OSV y juntar) y guardar en el historial, con registro de los
//! análisis en curso para poder cancelarlos. Sin Tauri: lo usan los comandos y el servidor MCP.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::analyze::{analyze, merge_rescan, ProgressFn};
use super::cache::OsvCache;
use super::model::*;
use super::osv::{HttpOsv, OsvApi, OsvError, OsvVuln};
use super::store::History;
use crate::error::{AppError, AppResult};

pub const PROGRESS_EVENT: &str = "vulnscan://progress";

fn running() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static R: std::sync::OnceLock<Mutex<HashMap<String, CancellationToken>>> = std::sync::OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registro de un análisis en curso (se quita al soltarlo).
pub struct ScanTicket {
    id: String,
    pub token: CancellationToken,
}

impl ScanTicket {
    pub fn new(id: &str) -> Self {
        let token = CancellationToken::new();
        if let Ok(mut m) = running().lock() {
            m.insert(id.to_string(), token.clone());
        }
        ScanTicket { id: id.to_string(), token }
    }
}

impl Drop for ScanTicket {
    fn drop(&mut self) {
        if let Ok(mut m) = running().lock() {
            m.remove(&self.id);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub scan_id: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub text: String,
}

/// Fases 5 y 6 + guardar en el historial. Reutilizable sin Tauri (MCP): ver `scan::scan_session`.
pub async fn analyze_and_save(
    input: &ScanInput,
    cancel: &CancellationToken,
    progress: ProgressFn<'_>,
    save: bool,
) -> AppResult<Report> {
    let cache = OsvCache::system();
    cache.clean_old();
    let api = HttpOsv::default();
    let report = analyze(input, input.use_osv.then_some(&api), &cache, cancel, progress).await?;
    if save {
        History::system().save(&report)?;
    }
    Ok(report)
}

/// Vuelve a analizar solo las imágenes de `images` (tras «Actualizar imagen») y las pone en lugar de
/// `old_key` en el informe `report_id`. Guarda el resultado como un análisis nuevo y lo devuelve.
pub async fn rescan_image(
    server_id: String,
    report_id: &str,
    old_key: &str,
    images: Vec<ImageRaw>,
    use_osv: bool,
    cancel: &CancellationToken,
    progress: ProgressFn<'_>,
) -> AppResult<Report> {
    let history = History::system();
    let base = history.get(&server_id, report_id)?;
    let input = ScanInput { server_id: server_id.clone(), images, elevated: base.elevated, use_osv, ..Default::default() };
    let partial = analyze_and_save(&input, cancel, progress, false).await?;
    let merged = merge_rescan(&base, old_key, &partial);
    history.save(&merged)?;
    Ok(merged)
}

/// Cancela las peticiones a OSV del análisis `scan_id`. false si ya terminó.
pub fn cancel(scan_id: &str) -> AppResult<bool> {
    let m = running().lock().map_err(|_| AppError::Invalid("registro bloqueado".into()))?;
    Ok(match m.get(scan_id) {
        Some(t) => {
            t.cancel();
            true
        }
        None => false,
    })
}

/// Detalle de un aviso (caché de OSV o, si no está, la API).
pub async fn vuln_detail(id: &str) -> AppResult<VulnDetail> {
    let cache = OsvCache::system();
    let value = match cache.get(id, None) {
        Some(v) => v,
        None => {
            let api = HttpOsv::default();
            let v = api.vuln(id).await.map_err(|e| match e {
                OsvError::NotFound => AppError::NotFound(format!("{id} en OSV")),
                e => e.into(),
            })?;
            if let Some(m) = v.get("modified").and_then(|m| m.as_str()) {
                cache.put(id, m, &v);
            }
            v
        }
    };
    let v: OsvVuln = serde_json::from_value(value).map_err(|e| AppError::Invalid(format!("aviso de OSV inesperado: {e}")))?;
    Ok(VulnDetail {
        id: v.id.clone(),
        summary: v.summary.clone(),
        details: v.details.clone(),
        aliases: v.aliases.iter().chain(&v.upstream).cloned().collect(),
        published: v.published.clone(),
        modified: v.modified.clone(),
        references: v.reference_urls(),
    })
}
