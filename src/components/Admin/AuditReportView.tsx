// Informe de la auditoría: nota general y por categoría, los problemas en orden de importancia (con
// «Arreglar todo lo seguro») y, debajo, lo demás por categoría.
import { ArrowDown, ArrowUp, Bot, CheckCircle2, Wrench } from "lucide-react";
import type { AuditReport, Check } from "../../api/audit";
import { CATEGORIES, problemsByImportance, safeFixes, statusOrder, type Comparison, type RecheckOutcome } from "../../features/audit";
import { AuditCheckRow, type FixAvailability } from "./AuditCheckRow";
import { useAdmin } from "./context";
import { MiniMarkdown } from "./MiniMarkdown";
import { CommandActions } from "./vulnUi";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

export function gradeClass(g: string | null): string {
  return g ? `au-grade-${g.toLowerCase()}` : "au-grade-none";
}

interface Props {
  report: AuditReport;
  cmp: Comparison | null;
  outcomes: Record<string, RecheckOutcome>;
  fixable: FixAvailability;
  onFix: (c: Check) => void;
  onFixAll: () => void;
  onOpenVulns: () => void;
  /** Terminó un «Reiniciar ahora» (desde «Reinicio pendiente»). */
  onRebooted: () => void;
}

export function AuditReportView({ report, cmp, outcomes, fixable, onFix, onFixAll, onOpenVulns, onRebooted }: Props) {
  const { sessionId } = useAdmin();
  const problems = problemsByImportance(report.checks);
  const safe = safeFixes(problems);
  const row = (c: Check) => (
    <AuditCheckRow
      key={c.id}
      check={c}
      change={cmp?.changes.get(c.id) ?? null}
      outcome={outcomes[c.id] ?? null}
      fixable={fixable}
      onFix={() => onFix(c)}
      onOpenVulns={c.id === "updates.vulns" ? onOpenVulns : undefined}
      onRebooted={c.id === "updates.reboot" ? onRebooted : undefined}
    />
  );
  return (
    <>
      <div className="au-summary">
        <div className={`au-grade ${gradeClass(report.grade)}`} aria-label={`Nota ${report.grade ?? "sin nota"}`}>
          {report.grade ?? "—"}
        </div>
        <div className="au-summary-text">
          <div className="au-score">
            {report.score ?? "—"}
            <span className="faint">/100</span>
            {cmp && cmp.scoreDelta !== null && cmp.scoreDelta !== 0 && (
              <span className={cmp.scoreDelta > 0 ? "au-delta au-better" : "au-delta au-worse"}>
                {cmp.scoreDelta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {Math.abs(cmp.scoreDelta)}
              </span>
            )}
          </div>
          <div>{report.summary}</div>
          <div className="faint">
            {when(report.createdAt)}
            {report.os ? ` · ${report.os}` : ""}
            {report.elevated ? " · con sudo" : " · sin sudo"}
            {cmp && ` · frente al ${when(cmp.previousAt)}: ${cmp.better} mejoran, ${cmp.worse} empeoran`}
          </div>
        </div>
      </div>

      <div className="au-cats">
        {report.categories.map((c) => (
          <a
            key={c.id}
            className="au-cat"
            href={`#au-${c.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`au-${sessionId}-${c.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          >
            <span className="au-cat-name">{c.label}</span>
            <span className={`au-cat-grade ${gradeClass(c.grade)}`}>{c.score === null ? "—" : `${c.score} ${c.grade}`}</span>
            <span className="au-bar">
              <span className={gradeClass(c.grade)} style={{ width: `${c.score ?? 0}%` }} />
            </span>
            <span className="faint au-cat-sum">{c.summary}</span>
          </a>
        ))}
      </div>

      {report.ai && (
        <div className="vs-ai-answer au-ai">
          <div className="vs-ai-mark">
            <Bot size={13} /> Texto generado por IA ({report.ai.model}): revísalo.
          </div>
          <MiniMarkdown text={report.ai.text} codeActions={(code) => <CommandActions sessionId={sessionId} text={code} />} />
        </div>
      )}

      <section className="au-section">
        <div className="au-fx-head">
          <div className="section-label">{problems.length ? `Qué arreglar primero (${problems.length})` : "Problemas"}</div>
          {safe.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={onFixAll} disabled={!fixable.ok} title={fixable.why ?? "Aplica de una vez lo que no puede dejarte fuera"}>
              <Wrench size={12} /> Arreglar todo lo seguro ({safe.length})
            </button>
          )}
        </div>
        {problems.length ? (
          problems.map(row)
        ) : (
          <div className="au-fx-line au-fx-ok">
            <CheckCircle2 size={13} /> Nada que arreglar
          </div>
        )}
      </section>

      {CATEGORIES.map((cat) => {
        const mine = report.checks.filter((c) => c.category === cat.id);
        if (!mine.length) return null;
        const rest = mine.filter((c) => c.status !== "bad" && c.status !== "warn").sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
        return (
          <section key={cat.id} className="au-section" id={`au-${sessionId}-${cat.id}`}>
            <div className="section-label">{cat.label}</div>
            {rest.length ? rest.map(row) : <div className="faint au-fx-reason">Sus problemas están arriba.</div>}
          </section>
        );
      })}
    </>
  );
}
