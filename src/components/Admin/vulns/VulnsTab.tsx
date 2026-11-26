// Sub-pestaña «Vulnerabilidades»: qué software tiene el servidor y qué vulnerabilidades conocidas le
// afectan. Columnas, filtros e iconos de fase en VulnsTable.tsx; filtros y filas en useVulnFilters.ts;
// barra y avisos en VulnsToolbar.tsx y VulnsBanners.tsx.
import { useCallback, useState } from "react";
import { Bot, RotateCcw, ShieldAlert } from "lucide-react";
import { errorMessage } from "../../../api/core";
import type { Report } from "../../../api/vulnscan";
import { loadStoreUsers, startScan, useVulnScan } from "../../../features/vulnscan";
import { hasActiveFilters } from "../../../features/vulnscan/findingRows";
import { useSettings } from "../../../stores/settings";
import { toast } from "../../../stores/toasts";
import { useAdmin } from "../context";
import { VirtualTable } from "../VirtualTable";
import { VulnSummary } from "./VulnSummary";
import { VulnDetail } from "./VulnDetail";
import { AiAnswer, AiExplainDialog } from "./AiExplainDialog";
import { ExportDialog, HistoryDialog, OptionsDialog, OsvSampleDialog, UsersDialog } from "./VulnsDialogs";
import { sudoToolOf } from "./vulnUi";
import { VulnFixBar } from "./VulnFixBar";
import { FixDialog } from "./FixDialog";
import { useVulnFix } from "./useVulnFix";
import { useVulnReport } from "./useVulnReport";
import { useVulnFilters } from "./useVulnFilters";
import { VulnScanPhases, VulnsSudoBanner } from "./VulnsBanners";
import { VulnsToolbar, type VulnsDialog } from "./VulnsToolbar";
import { buildVulnColumns, vulnRowKey, VulnsFilterBar } from "./VulnsTable";
import "./Vulns.css";
import "./VulnsDetail.css";
import "./VulnsAi.css";
import "./ImageUpdate.css";

export function VulnsTab() {
  const { sessionId, profileId, serverName, disabled, elevation, info } = useAdmin();
  const running = useVulnScan((s) => !!s.runs[sessionId]?.running);
  const setReport = useVulnScan((s) => s.setReport);
  const clearReport = useVulnScan((s) => s.clearReport);
  const users = useVulnScan((s) => s.users[sessionId] ?? null);
  const { report, diff } = useVulnReport(sessionId, profileId);
  const fix = useVulnFix(sessionId, report);
  const fl = useVulnFilters(sessionId, report);
  const { severity, origin, onlyFix, fixFilter, showUnimportant, query } = fl.filters;
  const { all, filtered, rows, unimportantCount, toggleKernel } = fl;

  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<VulnsDialog | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const selRow = rows.find((r) => vulnRowKey(r) === selected) ?? null;
  const tool = sudoToolOf(info, elevation);

  const analyze = useCallback(async () => {
    const r = await startScan({ sessionId, profileId, elevation, settings: useSettings.getState().settings.vulnscan });
    if (r) {
      setSelected(null);
      toast.success("Análisis terminado", `${r.summary.total} vulnerabilidades (${r.summary.withFix} con arreglo)`);
    } else {
      const st = useVulnScan.getState().runs[sessionId];
      if (st?.error) toast.error("El análisis no pudo terminar", st.error);
    }
  }, [sessionId, profileId, elevation]);

  const loadUsers = useCallback(async () => {
    if (!elevation) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      await loadStoreUsers(sessionId, elevation);
    } catch (e) {
      setUsersError(errorMessage(e));
    } finally {
      setUsersLoading(false);
    }
  }, [sessionId, elevation]);

  const openUsers = () => {
    setDialog("users");
    if (!users) void loadUsers();
  };

  const columns = buildVulnColumns(report, toggleKernel);

  return (
    <div className="adm-pane vs-root">
      <VulnsSudoBanner />
      <VulnsToolbar
        report={report}
        running={running}
        checking={!!fix.checking}
        onAnalyze={() => void analyze()}
        onOpenUsers={openUsers}
        onDialog={setDialog}
      />
      <VulnScanPhases sessionId={sessionId} />

      {report === undefined ? (
        <div className="empty-state">
          <span className="spinner" />
        </div>
      ) : !report ? (
        !running && (
          <div className="empty-state">
            <ShieldAlert size={22} />
            <div>Todavía no se ha analizado este servidor</div>
            <div className="faint adm-pre-wrap">
              «Analizar» lista el software instalado (paquetes, kernel, programas sueltos e imágenes de contenedores) y busca
              sus vulnerabilidades conocidas en OSV.dev y en la herramienta de seguridad de la distro. Es solo lectura.
            </div>
          </div>
        )
      ) : (
        <>
          <VulnSummary report={report} diff={diff} severity={severity} onSeverity={fl.setSeverity} />
          <VulnFixBar
            report={report}
            sessionId={sessionId}
            filter={fixFilter}
            onFilter={fl.setFixFilter}
            onFixAll={() => fix.openFix(report.findings)}
            checking={fix.checking}
            onRecheck={() => void fix.recheck()}
            onCancelCheck={fix.cancelRecheck}
            disabled={disabled || running}
          />
          {report.ai && (
            <details className="vs-ai-details">
              <summary>
                <Bot size={13} /> Explicación de la IA
              </summary>
              <AiAnswer report={report} sessionId={sessionId} />
            </details>
          )}
          {report.notes.length > 0 && (
            <details className="vs-notes">
              <summary>Avisos del análisis ({report.notes.length})</summary>
              <ul>
                {report.notes.map((n, i) => (
                  <li key={i} className={`vs-note-${n.level}`}>
                    {n.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <VulnsFilterBar
            report={report}
            query={query}
            setQuery={fl.setQuery}
            severity={severity}
            setSeverity={fl.setSeverity}
            origin={origin}
            setOrigin={fl.setOrigin}
            onlyFix={onlyFix}
            setOnlyFix={fl.setOnlyFix}
            unimportantCount={unimportantCount}
            showUnimportant={showUnimportant}
            setShowUnimportant={fl.setShowUnimportant}
          />
          <div className="vs-main">
            <VirtualTable
              label="Vulnerabilidades"
              columns={columns}
              rows={rows}
              rowKey={vulnRowKey}
              selected={selRow ? vulnRowKey(selRow) : null}
              onSelect={setSelected}
              onActivate={(r) => (r.kind === "kernel" ? toggleKernel() : setSelected(r.f.key))}
              rowClass={(r) => (r.kind === "kernel" ? "vs-row-kernel" : r.f.unimportant ? "adm-row-muted" : "")}
              placeholder={
                <div className="adm-empty-text">
                  {all.length === 0 ? "No se encontraron vulnerabilidades conocidas." : "Ninguna coincide con los filtros."}
                  {all.length > 0 && hasActiveFilters(fl.filters) && (
                    <div>
                      <button className="btn btn-sm" onClick={fl.clear}>
                        Quitar filtros
                      </button>
                    </div>
                  )}
                </div>
              }
            />
            {selRow && (
              <VulnDetail
                report={report}
                finding={selRow.kind === "f" ? selRow.f : null}
                kernel={selRow.kind === "kernel" ? selRow.items : null}
                sessionId={sessionId}
                tool={tool}
                onFix={running || disabled ? undefined : fix.openFix}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
          <div className="adm-statusbar">
            {filtered.length} de {all.length - (showUnimportant ? 0 : unimportantCount)}
            <span className="faint">·</span>
            <span>{new Date(report.createdAt).toLocaleString("es")}</span>
            <span className="faint">·</span>
            <span>{report.host.os.prettyName || report.host.os.id}</span>
            <span className="faint">·</span>
            <span>{report.elevated ? "con sudo" : "sin sudo"}</span>
            <span className="adm-spacer" />
            {report.host.inContainer && (
              <span className="faint" title="El kernel es el del anfitrión">
                <RotateCcw size={11} /> contenedor
              </span>
            )}
          </div>
        </>
      )}

      {fix.fixScope && report && <FixDialog report={report} findings={fix.fixScope} onClose={fix.closeFix} />}
      {dialog === "osv" && <OsvSampleDialog report={report ?? null} onClose={() => setDialog(null)} />}
      {dialog === "history" && (
        <HistoryDialog
          profileId={profileId}
          currentId={report?.id ?? null}
          onOpen={(r: Report) => {
            setReport(sessionId, r);
            setSelected(null);
          }}
          onDeleted={(id) => {
            if (!id || id === report?.id) clearReport(sessionId);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "export" && report && <ExportDialog report={report} profileId={profileId} serverName={serverName} onClose={() => setDialog(null)} />}
      {dialog === "users" && (
        <UsersDialog profileId={profileId} users={users} loading={usersLoading} error={usersError} onReload={() => void loadUsers()} onClose={() => setDialog(null)} />
      )}
      {dialog === "options" && <OptionsDialog onClose={() => setDialog(null)} />}
      {dialog === "ai" && report && (
        <AiExplainDialog report={report} profileId={profileId} onDone={(r) => setReport(sessionId, r)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
