// Sub-pestaña «Auditoría» de Administración: «Auditar servidor» revisa todo de una vez (sin instalar nada),
// da una nota general y por categoría, lo compara con la auditoría anterior y ofrece el arreglo de cada
// problema. Tras arreglar se vuelve a comprobar y se guarda el informe actualizado (AuditFixDialog).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileDown, KeyRound, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { errorMessage } from "../../api/core";
import { audit, type AuditMeta, type AuditReport, type Check } from "../../api/audit";
import { localfs } from "../../api/localfs";
import {
  compare,
  auditFixData,
  AUDITFIX_JOB,
  fixLevel,
  problemsByImportance,
  runAudit,
  safeFixes,
  toHtml,
  toMarkdown,
  useAuditRun,
  type RecheckOutcome,
} from "../../features/audit";
import { useJobFinished } from "../Jobs/useJobFinished";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { AuditAiDialog } from "./AuditAiDialog";
import { AuditFixAllDialog } from "./AuditFixAllDialog";
import { AuditFixDialog } from "./AuditFixDialog";
import { AuditReportView } from "./AuditReportView";
import { useAdmin } from "./context";
import "./Audit.css";
import "./AuditFix.css";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

export function AuditTab({ onOpenVulns, onOpenVisibility }: { onOpenVulns: () => void; onOpenVisibility?: () => void }) {
  const { sessionId, profileId, serverName, elevation, elev, disabled, askSudo } = useAdmin();
  const step = useAuditRun((s) => s.running[sessionId]);
  const [metas, setMetas] = useState<AuditMeta[]>([]);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [prev, setPrev] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<Check | "all" | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RecheckOutcome>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const gen = useRef(0);

  /** Muestra la auditoría `id` (o la última) y la anterior a ella para comparar. */
  const show = useCallback(
    async (id?: string) => {
      const g = ++gen.current;
      try {
        const list = await audit.historyList(profileId);
        if (g !== gen.current) return;
        setMetas(list);
        const i = id ? list.findIndex((m) => m.id === id) : 0;
        if (i < 0 || !list[i]) {
          setReport(null);
          setPrev(null);
          return;
        }
        const [cur, before] = await Promise.all([
          audit.historyGet(profileId, list[i].id),
          list[i + 1] ? audit.historyGet(profileId, list[i + 1].id).catch(() => null) : Promise.resolve(null),
        ]);
        if (g !== gen.current) return;
        setReport(cur);
        setPrev(before);
        setOutcomes({});
      } catch (e) {
        if (g === gen.current) setError(errorMessage(e));
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [profileId],
  );

  useEffect(() => {
    void show();
  }, [show]);

  const start = async () => {
    setError(null);
    try {
      const r = await runAudit({ sessionId, profileId, elevation });
      await show(r.id);
      toast.success("Auditoría terminada", r.score !== null ? `Nota ${r.score}/100 (${r.grade})` : r.summary);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const cmp = useMemo(() => (report ? compare(report, prev) : null), [report, prev]);
  const running = step !== undefined;
  const latest = !!report && report.id === metas[0]?.id;
  const fixable = {
    ok: latest && !disabled && !running && (!!elevation || elev.canAskSudo),
    why: !latest ? "Abre la última auditoría para arreglar" : disabled ? "Sin conexión" : !elevation && !elev.canAskSudo ? "Necesitas root o sudo" : null,
  };

  // Tras unos arreglos (aunque su diálogo ya se cerrara): el informe ya comprobado de nuevo y guardado
  // (mismo id) y la lista del historial. El aviso del resultado lo da la tarea.
  useJobFinished(
    (j) => j.kind === AUDITFIX_JOB && j.sessionId === sessionId,
    (j) => {
      const d = auditFixData(j);
      if (!d.report) return;
      if (d.report.id === report?.id) setReport(d.report);
      setOutcomes((s) => ({ ...s, ...d.outcomes }));
      void audit.historyList(profileId).then(setMetas).catch(() => undefined);
    },
  );

  const exportAs = async (format: "md" | "html") => {
    if (!report) return;
    let path: string | null;
    try {
      path = await saveFileDialog({
        title: "Exportar auditoría",
        defaultPath: `auditoria-${report.createdAt.slice(0, 10)}.${format}`,
        filters: [{ name: format === "md" ? "Markdown" : "HTML", extensions: [format] }],
      });
    } catch (e) {
      toast.error("No se pudo abrir el diálogo para guardar", e);
      return;
    }
    if (!path) return;
    if (!path.toLowerCase().endsWith(`.${format}`)) path += `.${format}`;
    try {
      await localfs.writeText(path, format === "md" ? toMarkdown(report, serverName, cmp) : toHtml(report, serverName, cmp));
      toast.success("Auditoría exportada", path);
    } catch (e) {
      toast.error("No se pudo exportar", e);
    }
  };

  const remove = async () => {
    if (!report) return;
    const yes = await confirmDialog({ title: "Borrar auditoría", message: `¿Borrar la auditoría del ${when(report.createdAt)}?`, confirmText: "Borrar", danger: true });
    if (!yes) return;
    try {
      await audit.historyDelete(profileId, report.id);
      await show();
    } catch (e) {
      toast.error("No se pudo borrar", e);
    }
  };

  return (
    <div className="adm-pane au-root">
      <div className="adm-toolbar">
        <button className="btn btn-sm btn-primary" onClick={() => void start()} disabled={disabled || running} title="Revisa todo sin instalar nada en el servidor">
          {running ? <span className="spinner adm-spinner-btn" /> : <ShieldCheck size={13} />}
          {running ? step : "Auditar servidor"}
        </button>
        {!elevation && elev.canAskSudo && !running && (
          <button className="btn btn-sm" onClick={askSudo} title="Con sudo se comprueba todo">
            <KeyRound size={13} /> Con sudo…
          </button>
        )}
        {metas.length > 0 && (
          <select
            className="input au-history"
            value={report?.id ?? ""}
            onChange={(e) => void show(e.target.value)}
            aria-label="Auditorías anteriores"
            disabled={running}
          >
            {metas.map((m) => (
              <option key={m.id} value={m.id}>
                {when(m.createdAt)} · {m.score ?? "—"} {m.grade ?? ""}
                {m.elevated ? "" : " · sin sudo"}
              </option>
            ))}
          </select>
        )}
        <span className="au-spacer" />
        {report && (
          <>
            <button className="btn btn-sm" onClick={() => setAiOpen(true)} title="Explicación en lenguaje simple (antes ves qué se envía)">
              <Sparkles size={13} /> Explicar con IA
            </button>
            <button className="btn btn-sm" onClick={() => void exportAs("md")} title="Exportar a Markdown">
              <FileDown size={13} /> Markdown
            </button>
            <button className="btn btn-sm" onClick={() => void exportAs("html")} title="Exportar a HTML">
              <FileDown size={13} /> HTML
            </button>
            <button className="icon-btn" onClick={() => void remove()} title="Borrar esta auditoría" aria-label="Borrar esta auditoría">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="adm-banner adm-banner-warn" role="alert">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">{error}</span>
        </div>
      )}

      <div className="au-scroll">
        {loading ? (
          <div className="empty-state">
            <span className="spinner" />
          </div>
        ) : !report ? (
          <div className="empty-state">
            <ShieldCheck size={22} />
            <div>Revisa SSH, usuarios, red, actualizaciones, certificados, contenedores y permisos de una vez.</div>
            <div className="faint">Solo lee: no instala ni cambia nada.</div>
          </div>
        ) : (
          <AuditReportView
            report={report}
            cmp={cmp}
            outcomes={outcomes}
            fixable={fixable}
            onFix={setFixing}
            onFixAll={() => setFixing("all")}
            onOpenVulns={onOpenVulns}
            onOpenVisibility={onOpenVisibility}
            onRebooted={() => void start()}
          />
        )}
      </div>

      {fixing === "all" && report && (
        <AuditFixAllDialog
          report={report}
          safe={safeFixes(problemsByImportance(report.checks))}
          risky={problemsByImportance(report.checks).filter((c) => fixLevel(c) === "confirm")}
          onClose={() => setFixing(null)}
        />
      )}
      {fixing && fixing !== "all" && report && <AuditFixDialog check={fixing} report={report} onClose={() => setFixing(null)} />}
      {aiOpen && report && <AuditAiDialog report={report} profileId={profileId} onDone={setReport} onClose={() => setAiOpen(false)} />}
    </div>
  );
}
