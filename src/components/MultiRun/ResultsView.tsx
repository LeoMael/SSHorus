// Paso 2: progreso y resultados (cabecera, barra de herramientas y selector de subvista).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Columns3, Copy, GitCompareArrows, KeyRound, Pencil, RotateCcw, Rows3, Square } from "lucide-react";
import { STATUS_LABEL, formatDuration, formatReport, formatTable, summarize } from "../../features/multirun/results";
import { multiRunActions, repeatMultiRun, showSetup, useMultiRun } from "../../features/multirun/store";
import { isProblem, type TargetStatus } from "../../features/multirun/types";
import { CompareView, SideView, StatusIcon, TableView, copyMultiRunText } from "./ResultsSubViews";

export { StatusIcon };

type ViewMode = "table" | "side" | "compare";

const VIEW_KEY = "sshorus.multirun.view";

function readView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "side" || v === "compare" ? v : "table";
  } catch {
    return "table";
  }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function Chip({ status, n, children }: { status: TargetStatus; n: number; children?: ReactNode }) {
  if (n === 0) return null;
  return (
    <span className={`mr-sum-chip st-${status}`}>
      <StatusIcon status={status} size={12} /> {n} {children ?? STATUS_LABEL[status].toLowerCase()}
    </span>
  );
}

export function ResultsView() {
  const run = useMultiRun((s) => s.run);
  const [view, setView] = useState<ViewMode>(readView);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const targets = useMemo(() => run?.targets ?? [], [run]);
  const sum = useMemo(() => summarize(targets), [targets]);
  const busy = sum.counts.queued + sum.counts.connecting + sum.counts.running > 0;
  const now = useNow(busy);

  const shown = useMemo(() => (onlyErrors ? targets.filter((t) => isProblem(t.status)) : targets), [targets, onlyErrors]);

  if (!run) return null;

  const changeView = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const failed = sum.counts.error + sum.counts.timeout + sum.counts.canceled;
  const pct = sum.total === 0 ? 0 : Math.round((sum.done / sum.total) * 100);
  const elapsed = (busy ? now : Math.max(...targets.map((t) => t.finishedAt ?? 0), run.startedAt)) - run.startedAt;

  return (
    <div className="mr-results">
      <div className="mr-res-head">
        <div className="mr-res-cmd">
          {run.spec.label && <span className="mr-res-label">{run.spec.label}</span>}
          <code className="mono" title={run.spec.command}>
            {run.spec.command}
          </code>
        </div>
        <div className="mr-res-progress">
          <span className="muted">
            {busy ? "En curso" : sum.counts.attention > 0 ? "Esperando atención" : "Terminado"} · {sum.done}/{sum.total} · {formatDuration(elapsed)}
          </span>
          <div className="progress mr-progress" aria-label={`${pct}% terminado`}>
            <div
              style={{ width: `${pct}%` }}
              className={sum.counts.error + sum.counts.timeout > 0 ? "has-errors" : busy ? "" : "done"}
            />
          </div>
        </div>
        <div className="mr-sum">
          <Chip status="ok" n={sum.counts.ok}>
            correcto{sum.counts.ok === 1 ? "" : "s"}
          </Chip>
          <Chip status="error" n={sum.counts.error}>
            con error
          </Chip>
          <Chip status="timeout" n={sum.counts.timeout}>
            sin tiempo
          </Chip>
          <Chip status="attention" n={sum.counts.attention}>
            requiere{sum.counts.attention === 1 ? "" : "n"} atención
          </Chip>
          <Chip status="running" n={sum.counts.running}>
            ejecutando
          </Chip>
          <Chip status="connecting" n={sum.counts.connecting}>
            conectando
          </Chip>
          <Chip status="queued" n={sum.counts.queued}>
            en cola
          </Chip>
          <Chip status="canceled" n={sum.counts.canceled}>
            cancelado{sum.counts.canceled === 1 ? "" : "s"}
          </Chip>
        </div>
      </div>

      {sum.counts.attention > 0 && (
        <div className="mr-banner warn mr-attn">
          <AlertTriangle size={16} />
          <div className="mr-grow">
            {sum.counts.attention === 1 ? "1 servidor necesita" : `${sum.counts.attention} servidores necesitan`} que
            hagas algo para conectar (contraseña no guardada, huella nueva o código 2FA).
          </div>
          <button className="btn btn-sm" onClick={() => void multiRunActions.resolveAll()}>
            <KeyRound size={13} /> {sum.counts.attention === 1 ? "Resolver" : "Resolver uno a uno"}
          </button>
        </div>
      )}

      <div className="mr-toolbar">
        <div className="mr-seg" role="radiogroup" aria-label="Vista">
          <button role="radio" aria-checked={view === "table"} className={view === "table" ? "on" : ""} onClick={() => changeView("table")}>
            <Rows3 size={13} /> Tabla
          </button>
          <button role="radio" aria-checked={view === "side"} className={view === "side" ? "on" : ""} onClick={() => changeView("side")}>
            <Columns3 size={13} /> Lado a lado
          </button>
          <button
            role="radio"
            aria-checked={view === "compare"}
            className={view === "compare" ? "on" : ""}
            onClick={() => changeView("compare")}
            title="Agrupa los servidores que dieron exactamente la misma salida"
          >
            <GitCompareArrows size={13} /> Comparar salidas
          </button>
        </div>
        {view !== "compare" && (
          <label className="checkbox mr-only-errors">
            <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            Solo errores
          </label>
        )}
        <span className="mr-grow" />
        {busy && (
          <button className="btn btn-sm btn-danger" onClick={() => multiRunActions.cancelAll()}>
            <Square size={13} /> Cancelar todo
          </button>
        )}
        {!busy && failed > 0 && (
          <button className="btn btn-sm" onClick={() => multiRunActions.retryFailed()}>
            <RotateCcw size={13} /> Reintentar fallidos ({failed})
          </button>
        )}
        <button className="btn btn-sm" title="Informe completo en texto" onClick={() => void copyMultiRunText(formatReport(run.spec.command, shown), "Informe")}>
          <Copy size={13} /> Copiar todo
        </button>
        <button
          className="btn btn-sm"
          title="Resumen separado por tabuladores (se pega en una hoja de cálculo)"
          onClick={() => void copyMultiRunText(formatTable(shown), "Resumen")}
        >
          <Copy size={13} /> Copiar tabla
        </button>
      </div>

      <div className="mr-res-body">
        {shown.length === 0 && onlyErrors && view !== "compare" ? (
          <div className="mr-empty">Ningún servidor con errores.</div>
        ) : view === "table" ? (
          <TableView targets={shown} now={now} />
        ) : view === "side" ? (
          <SideView targets={shown} now={now} />
        ) : (
          <CompareView targets={targets} command={run.spec.command} />
        )}
      </div>

      <div className="mr-footer">
        <span className="mr-footer-msg faint">
          {busy
            ? "Las conexiones abiertas para esta ejecución se cierran al terminar cada servidor."
            : "Las pestañas que ya tenías abiertas no se tocan."}
        </span>
        <span className="mr-grow" />
        <button className="btn" disabled={busy} onClick={showSetup} title="Volver a elegir servidores o comando">
          <Pencil size={14} /> Editar
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={repeatMultiRun}>
          <RotateCcw size={14} /> Repetir
        </button>
      </div>
    </div>
  );
}
