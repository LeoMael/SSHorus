//! Escaneos (puertos, sitios, contenedores), vulnerabilidades y auditoría del servidor.

use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::super::backend::Backend;
use super::super::policy::Action;
use super::super::{server_audit, vuln};
use super::output::{clip_middle, pretty};
use super::{
    AuditReportParams, Fail, McpCore, Rec, Res, ServerParams, VulnReportParams, VulnScanParams,
    DEFAULT_VULN_SCAN_SECS, MAX_SCAN_BYTES, MAX_VULN_SCAN_SECS, MIN_VULN_SCAN_SECS, UI_AUDIT_TIMEOUT, UI_SCAN_TIMEOUT,
    VULN_STOP_GRACE,
};
use crate::error::AppError;
use crate::vulnscan::scan::ScanOptions;

impl<B: Backend> McpCore<B> {
    // ───────────── Escaneos (puertos, sitios, contenedores) ─────────────

    pub(super) async fn scan(&self, kind: &str, p: ServerParams, rec: &mut Rec) -> Res<String> {
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read(kind), "", "", None).await?;
        let v = self.backend.ui_request(kind, json!({ "sessionId": sid }), UI_SCAN_TIMEOUT).await?;
        let text = serde_json::to_string_pretty(&v).unwrap_or_default();
        Ok(clip_middle(&text, MAX_SCAN_BYTES))
    }

    // ───────────── Vulnerabilidades ─────────────

    /// Último informe guardado (de la interfaz o de `scan_vulnerabilities`), resumido. No hace falta
    /// conexión: se lee del historial de este PC.
    pub(super) async fn vuln_report(&self, p: VulnReportParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = "último informe".into();
        let t = self.target(&p.server, None, rec).await?;
        self.authorize(rec, &t, Action::read("get_vuln_report"), "", "", None).await?;
        match self.backend.vuln_latest(&t.server.id).await? {
            Some(r) => {
                rec.entry.message = Some(format!("informe del {}", r.created_at));
                Ok(pretty(&vuln::summarize(&t.server.name, &r, p.limit)))
            }
            None => Ok(format!(
                "«{}» no tiene ningún análisis de vulnerabilidades guardado. Usa scan_vulnerabilities \
                 (o pide al usuario que pulse Analizar en SSHorus → Administración → Vulnerabilidades).",
                t.server.name
            )),
        }
    }

    /// Análisis nuevo SIN sudo. No cambia el servidor, pero tarda minutos y consulta OSV.dev desde
    /// este PC: pide permiso (con «Permitir siempre»), también en servidores de solo lectura.
    pub(super) async fn vuln_scan(&self, p: VulnScanParams, rec: &mut Rec, cancel: &CancellationToken) -> Res<String> {
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        let timeout = p.timeout_secs.unwrap_or(DEFAULT_VULN_SCAN_SECS).clamp(MIN_VULN_SCAN_SECS, MAX_VULN_SCAN_SECS);
        rec.entry.detail = format!("análisis sin sudo (máx. {timeout} s)");
        let settings = self.backend.vuln_settings();
        let mut opts = ScanOptions::new(&t.server.id);
        opts.use_osv = settings.use_osv;
        opts.use_distro_tool = settings.use_distro_tool;
        opts.use_trivy = settings.use_trivy;
        opts.scan_images = settings.scan_images;
        opts.image_limit = settings.image_limit as usize;
        opts.save = true;

        let mut shown = vec![format!(
            "Análisis de vulnerabilidades SIN sudo como «{}». No cambia nada en el servidor:",
            t.server.username
        )];
        shown.push("• lee la lista de paquetes y programas instalados".into());
        if opts.use_distro_tool {
            shown.push("• usa la herramienta de seguridad de la distro si la hay (dnf, debsecan, pro, zypper)".into());
        }
        if opts.scan_images {
            shown.push(format!(
                "• lee hasta {} imágenes de contenedores del usuario sin arrancarlas{}",
                opts.image_limit,
                if opts.use_trivy { " (con Trivy si está instalado)" } else { "" }
            ));
        }
        if opts.use_osv {
            shown.push("• desde este PC consulta OSV.dev (solo nombres y versiones de paquetes)".into());
        }
        shown.push(format!("Tiempo máximo: {timeout} s. El informe se guarda en el historial."));

        let busy = || {
            Fail::Error(format!(
                "Ya hay un análisis de vulnerabilidades en curso en «{}»: espera a que termine.",
                t.server.name
            ))
        };
        if self.vuln_scans.lock().unwrap_or_else(|p| p.into_inner()).contains(&t.server.id) {
            return Err(busy());
        }
        let title = "quiere buscar vulnerabilidades (sin sudo; tarda unos minutos)";
        self.authorize(rec, &t, Action::change_on_read("scan_vulnerabilities"), title, &shown.join("\n"), None).await?;

        // Uno a la vez por servidor (se comprueba otra vez: la aprobación pudo tardar).
        if !self.vuln_scans.lock().unwrap_or_else(|p| p.into_inner()).insert(t.server.id.clone()) {
            return Err(busy());
        }
        let _running = RunningScan { set: &self.vuln_scans, id: t.server.id.clone() };

        let exec_id = format!("mcp-{}", uuid::Uuid::new_v4().simple());
        rec.entry.exec_id = Some(exec_id.clone());
        rec.entry.message = Some("Analizando (puede tardar unos minutos)".into());
        self.audit.record(rec.entry.clone());
        rec.entry.message = None;

        let stop = CancellationToken::new();
        let run = self.backend.vuln_scan(&sid, opts, &exec_id, &stop);
        tokio::pin!(run);
        let mut timed_out = false;
        let result = tokio::select! {
            r = &mut run => r,
            () = cancel.cancelled() => {
                stop.cancel();
                tokio::time::timeout(VULN_STOP_GRACE, &mut run).await.unwrap_or(Err(AppError::Canceled))
            }
            () = tokio::time::sleep(Duration::from_secs(u64::from(timeout))) => {
                timed_out = true;
                stop.cancel();
                tokio::time::timeout(VULN_STOP_GRACE, &mut run).await.unwrap_or(Err(AppError::Canceled))
            }
        };
        match result {
            Ok(r) => {
                let s = &r.summary;
                rec.entry.message = Some(format!(
                    "{} vulnerabilidades ({} críticas, {} altas)",
                    s.total, s.critical, s.high
                ));
                Ok(pretty(&vuln::summarize(&t.server.name, &r, p.limit)))
            }
            Err(AppError::Canceled) if timed_out => Err(Fail::Error(format!(
                "El análisis pasó de {timeout} s y se detuvo (también en el servidor). Vuelve a intentarlo con un \
                 timeout_secs mayor (máximo {MAX_VULN_SCAN_SECS}) o pide al usuario que lo haga desde SSHorus."
            ))),
            Err(AppError::Canceled) => Err(Fail::Error("Se canceló el análisis (y se detuvo en el servidor).".into())),
            Err(e) => Err(e.into()),
        }
    }

    // ───────────── Auditoría del servidor ─────────────

    /// Última auditoría guardada (de SSHorus o de `run_audit`), resumida. No hace falta conexión.
    pub(super) async fn audit_report(&self, p: AuditReportParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = "última auditoría".into();
        let t = self.target(&p.server, None, rec).await?;
        self.authorize(rec, &t, Action::read("get_audit_report"), "", "", None).await?;
        match self.backend.audit_latest(&t.server.id).await? {
            Some(r) => {
                rec.entry.message = Some(format!("auditoría del {}", r.created_at));
                Ok(pretty(&server_audit::summarize(&t.server.name, &r)))
            }
            None => Ok(format!(
                "«{}» no tiene ninguna auditoría guardada. Usa run_audit (o pide al usuario que pulse \
                 «Auditar servidor» en SSHorus → Administración → Auditoría).",
                t.server.name
            )),
        }
    }

    /// Auditoría nueva SIN sudo (la hace la interfaz, igual que el botón). Solo lee, pero pide permiso
    /// la primera vez porque revisa muchas cosas del servidor. Se guarda en el historial.
    pub(super) async fn run_audit(&self, p: ServerParams, rec: &mut Rec) -> Res<String> {
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        rec.entry.detail = "auditoría sin sudo".into();
        let shown = format!(
            "Auditoría SIN sudo como «{}». No cambia nada ni instala nada en el servidor:\n\
             • lee la configuración de SSH, usuarios, puertos, cortafuegos, actualizaciones, sitios web,\n  \
             contenedores, servicios, intentos de entrada, disco, memoria y permisos\n\
             • usa el último informe de vulnerabilidades guardado (no lanza el escáner)\n\
             El informe se guarda en el historial de SSHorus.",
            t.server.username
        );
        let title = "quiere auditar el servidor (sin sudo; solo lectura)";
        self.authorize(rec, &t, Action::change_on_read("run_audit"), title, &shown, None).await?;
        let v = self
            .backend
            .ui_request("audit", json!({ "sessionId": sid, "profileId": t.server.id }), UI_AUDIT_TIMEOUT)
            .await?;
        let r: crate::audit::model::AuditReport =
            serde_json::from_value(v).map_err(|e| Fail::Error(format!("auditoría no válida: {e}")))?;
        rec.entry.message = Some(match (r.score, r.grade.as_deref()) {
            (Some(s), Some(g)) => format!("nota {s}/100 ({g})"),
            _ => "auditoría hecha".into(),
        });
        Ok(pretty(&server_audit::summarize(&t.server.name, &r)))
    }
}

/// Quita el servidor de los análisis en curso al terminar (también si se cancela o falla).
struct RunningScan<'a> {
    set: &'a Mutex<BTreeSet<String>>,
    id: String,
}

impl Drop for RunningScan<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap_or_else(|p| p.into_inner()).remove(&self.id);
    }
}
