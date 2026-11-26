//! Comandos Tauri del escáner. La interfaz ejecuta los scripts en el servidor (con su elevación) y
//! le pasa aquí las salidas; el motor consulta OSV, junta, guarda en el historial y exporta. Aquí
//! solo hay envoltorios finos sobre `plan`, `run`, `recheck`, `store` y `export`.

use tauri::{AppHandle, Emitter};

use super::export;
use super::model::*;
use super::plan::{self, ImagesView, ScanPlan, ScriptRequest, UsersView};
use super::recheck;
use super::run::{self, analyze_and_save, ProgressPayload, ScanTicket, PROGRESS_EVENT};
use super::store::History;
use crate::error::{AppError, AppResult};

/// Emite el progreso del análisis `scan_id` como evento `vulnscan://progress`.
fn progress_emitter(app: AppHandle, scan_id: &str) -> impl Fn(&str, usize, usize, &str) + Send + Sync {
    let sid = scan_id.to_string();
    move |phase: &str, done: usize, total: usize, text: &str| {
        let _ = app.emit(
            PROGRESS_EVENT,
            ProgressPayload { scan_id: sid.clone(), phase: phase.into(), done, total, text: text.into() },
        );
    }
}

#[tauri::command]
pub async fn vulnscan_script(req: ScriptRequest) -> AppResult<String> {
    Ok(plan::script_for(&req))
}

#[tauri::command]
pub async fn vulnscan_plan(detect: String) -> AppResult<ScanPlan> {
    Ok(plan::plan_from(&detect))
}

#[tauri::command]
pub async fn vulnscan_parse_users(output: String) -> AppResult<UsersView> {
    Ok(plan::users_view(&output))
}

#[tauri::command]
pub async fn vulnscan_parse_images(engine: Engine, output: String, limit: u32) -> AppResult<ImagesView> {
    Ok(plan::select_images(engine, &output, limit as usize))
}

// ───────────── Análisis (fases 5 y 6) ─────────────

/// Analiza lo recogido por la interfaz, lo guarda en el historial y lo devuelve.
/// El progreso llega por el evento `vulnscan://progress`; se cancela con `vulnscan_cancel(scan_id)`.
#[tauri::command]
pub async fn vulnscan_analyze(app: AppHandle, input: ScanInput, scan_id: String) -> AppResult<Report> {
    let ticket = ScanTicket::new(&scan_id);
    let emit = progress_emitter(app, &scan_id);
    analyze_and_save(&input, &ticket.token, &emit, true).await
}

/// Vuelve a analizar solo las imágenes de `images` (tras «Actualizar imagen») y las pone en lugar de
/// `old_key` en el informe `report_id`. Guarda el resultado como un análisis nuevo y lo devuelve.
#[tauri::command]
pub async fn vulnscan_rescan_image(
    app: AppHandle,
    server_id: String,
    report_id: String,
    old_key: String,
    images: Vec<ImageRaw>,
    use_osv: bool,
    scan_id: String,
) -> AppResult<Report> {
    let ticket = ScanTicket::new(&scan_id);
    let emit = progress_emitter(app, &scan_id);
    run::rescan_image(server_id, &report_id, &old_key, images, use_osv, &ticket.token, &emit).await
}


/// Vuelve a comprobar el sistema del informe `report_id` con lo que la interfaz acaba de leer del
/// servidor (`input`, sin imágenes) y lo guarda como un análisis nuevo. Progreso y cancelación como
/// `vulnscan_analyze`.
#[tauri::command]
pub async fn vulnscan_recheck(app: AppHandle, server_id: String, report_id: String, input: ScanInput, scan_id: String) -> AppResult<Report> {
    let ticket = ScanTicket::new(&scan_id);
    let emit = progress_emitter(app, &scan_id);
    recheck::recheck(server_id, &report_id, input, &ticket.token, &emit).await
}

/// Cancela las peticiones a OSV de un análisis. false si ya terminó.
#[tauri::command]
pub async fn vulnscan_cancel(scan_id: String) -> AppResult<bool> {
    run::cancel(&scan_id)
}

// ───────────── Historial ─────────────

#[tauri::command]
pub async fn vulnscan_history_list(server_id: String) -> AppResult<Vec<ReportMeta>> {
    History::system().list(&server_id)
}

#[tauri::command]
pub async fn vulnscan_history_get(server_id: String, report_id: String) -> AppResult<Report> {
    History::system().get(&server_id, &report_id)
}

/// Último informe del servidor (None si nunca se analizó).
#[tauri::command]
pub async fn vulnscan_latest(server_id: String) -> AppResult<Option<Report>> {
    History::system().latest(&server_id)
}

/// Borra un análisis (o todo el historial del servidor si `report_id` no viene).
#[tauri::command]
pub async fn vulnscan_history_delete(server_id: String, report_id: Option<String>) -> AppResult<()> {
    History::system().delete(&server_id, report_id.as_deref())
}

/// Guarda la explicación de la IA junto al análisis (None la quita).
#[tauri::command]
pub async fn vulnscan_set_ai(server_id: String, report_id: String, ai: Option<AiExplanation>) -> AppResult<Report> {
    History::system().set_ai(&server_id, &report_id, ai)
}

/// Exporta un análisis a `path` (ruta completa elegida con el diálogo del sistema).
/// `format`: "json" | "markdown". `server_name` None = no ponerlo («servidor-1»).
#[tauri::command]
pub async fn vulnscan_export(
    server_id: String,
    report_id: String,
    path: String,
    format: String,
    server_name: Option<String>,
) -> AppResult<()> {
    let report = History::system().get(&server_id, &report_id)?;
    let text = export::render(&report, &format, server_name.as_deref())?;
    let p = std::path::PathBuf::from(path.trim());
    if !p.is_absolute() {
        return Err(AppError::Invalid("La ruta debe ser completa".into()));
    }
    tokio::task::spawn_blocking(move || crate::localfs::write_text(&p, &text))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

/// Detalle de un aviso (caché de OSV o, si no está, la API).
#[tauri::command]
pub async fn vulnscan_vuln_detail(id: String) -> AppResult<VulnDetail> {
    run::vuln_detail(&id).await
}
