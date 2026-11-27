// Un servidor en «Auditar proyecto»: nota, problemas, estado de la tarea y, desplegado, sus problemas en orden
// de importancia. «Abrir» lleva a su informe completo (Administración → Auditoría).
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, KeyRound, RotateCw, XCircle } from "lucide-react";
import { ROW_STATUS_TEXT, problemsByImportance, rowBusy } from "../../features/audit";
import type { ProjectAuditItem } from "./useProjectAuditData";
import { openServerAudit } from "./openServerAudit";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export function GradeBadge({ grade, score }: { grade: string | null; score: number | null }) {
  return (
    <span className={`au-grade pa-grade au-grade-${grade ? grade.toLowerCase() : "none"}`} title={score !== null ? `${score}/100` : "Sin nota"}>
      {grade ?? "—"}
    </span>
  );
}

interface Props {
  item: ProjectAuditItem;
  /** Se puede lanzar una auditoría ahora (no hay otra del proyecto en marcha). */
  canRun: boolean;
  onAudit: () => void;
}

export function ProjectAuditRow({ item, canRun, onAudit }: Props) {
  const [open, setOpen] = useState(false);
  const { row, report } = item;
  const busy = rowBusy(row);
  const bad = report?.checks.filter((c) => c.status === "bad").length ?? 0;
  const warn = report?.checks.filter((c) => c.status === "warn").length ?? 0;
  const problems = report ? problemsByImportance(report.checks) : [];
  const state = busy ? (row.step ?? ROW_STATUS_TEXT[row.status]) : row.status === "error" || row.status === "canceled" ? ROW_STATUS_TEXT[row.status] : null;
  return (
    <div className={`pa-row${open ? " pa-row-open" : ""}`}>
      <div className="pa-row-head">
        <button className="au-toggle" onClick={() => setOpen(!open)} disabled={!report} aria-expanded={open} aria-label={open ? "Ocultar problemas" : "Ver problemas"}>
          {report ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="au-toggle-sp" />}
        </button>
        <GradeBadge grade={report?.grade ?? null} score={report?.score ?? null} />
        <span className="pa-name" title={item.name}>
          {item.name}
        </span>
        <span className="pa-score">{report?.score ?? "—"}</span>
        <span className="pa-counts">
          {report ? (
            <>
              {bad > 0 && <span className="pa-bad">{bad} mal</span>}
              {warn > 0 && <span className="pa-warn">{warn} {warn === 1 ? "aviso" : "avisos"}</span>}
              {bad + warn === 0 && <span className="faint">sin problemas</span>}
              {!report.elevated && (
                <span className="pa-nosudo" title="Se auditó sin sudo: lo que necesita root quedó sin comprobar">
                  <KeyRound size={11} /> sin sudo
                </span>
              )}
            </>
          ) : (
            <span className="faint">sin auditar</span>
          )}
        </span>
        <span className={`pa-state${row.status === "error" ? " pa-state-error" : ""}`} title={row.error ?? undefined}>
          {busy && <span className="spinner pa-spinner" />}
          {row.status === "error" && <XCircle size={12} />}
          {state ?? (report ? when(report.createdAt) : "")}
        </span>
        <button className="icon-btn" onClick={onAudit} disabled={!canRun || busy} title="Auditar solo este servidor" aria-label="Auditar solo este servidor">
          <RotateCw size={13} />
        </button>
        <button className="icon-btn" onClick={() => void openServerAudit(item.server)} title="Abrir su informe en Administración (con «Arreglar»)" aria-label="Abrir en Administración">
          <ExternalLink size={13} />
        </button>
      </div>
      {row.status === "error" && row.error && (
        <div className="pa-error">
          <AlertTriangle size={12} /> {row.error}
        </div>
      )}
      {open && report && (
        <div className="pa-problems">
          {problems.length === 0 && <div className="faint">No hay problemas.</div>}
          {problems.slice(0, 12).map((c) => (
            <div key={c.id} className={`pa-problem au-${c.status}`}>
              {c.status === "bad" ? <XCircle size={12} className="au-icon" /> : <AlertTriangle size={12} className="au-icon" />}
              <span className="au-title">{c.title}</span>
              <span className="au-detail" title={c.items.join("\n") || undefined}>
                {c.detail}
              </span>
            </div>
          ))}
          {problems.length > 12 && <div className="faint">Y {problems.length - 12} más: ábrelo en Administración.</div>}
        </div>
      )}
    </div>
  );
}
