// Lista virtualizada de trabajos individuales dentro de un lote de transferencias.
import { memo, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, CircleMinus, Clock, Loader2, Pause, Play, RotateCcw, X } from "lucide-react";
import { transfers } from "../../api/transfers";
import type { TransferJob, TransferStatus } from "../../api/types";
import { formatBytes, formatSpeed } from "../../lib/format";
import { batchJobIds, formatCount, isActiveStatus, useTransfers, type BatchSummary } from "../../stores/transfers";
import { act, Bar, IconBtn, JOB_STATUS_LABEL, pauseIds, resumeIds, retryIds, skippedText } from "./TransferHelpers";

const ROW_H = 24;
const MAX_ROWS = 8;
const OVERSCAN = 6;
const ORDER: Record<TransferStatus, number> = { running: 0, error: 1, paused: 2, queued: 3, done: 4, skipped: 5, canceled: 6 };

type Filter = "all" | "pending" | "skipped" | "error";

export function JobList({ batch }: { batch: BatchSummary }) {
  const [filter, setFilter] = useState<Filter>(batch.error > 0 && !isActiveStatus(batch.status) ? "error" : "all");
  const [scrollTop, setScrollTop] = useState(0);

  const rows = useMemo(() => {
    const jobs = useTransfers.getState().jobs;
    const out: TransferJob[] = [];
    for (const id of batchJobIds(batch.id)) {
      const j = jobs[id];
      if (!j) continue;
      if (filter === "error" && j.status !== "error") continue;
      if (filter === "skipped" && j.status !== "skipped") continue;
      if (filter === "pending" && (j.status === "done" || j.status === "canceled" || j.status === "skipped")) continue;
      out.push(j);
    }
    out.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    return out;
  }, [batch.id, batch.version, filter]);

  const height = Math.max(1, Math.min(rows.length, MAX_ROWS)) * ROW_H;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const pending = batch.running + batch.queued + batch.paused;

  return (
    <div className="tp-jobs">
      <div className="tp-filters" role="tablist">
        <FilterBtn cur={filter} v="all" set={setFilter}>
          Todos ({formatCount(batch.total)})
        </FilterBtn>
        <FilterBtn cur={filter} v="pending" set={setFilter}>
          Pendientes ({formatCount(pending)})
        </FilterBtn>
        {batch.skipped > 0 && (
          <FilterBtn cur={filter} v="skipped" set={setFilter}>
            Omitidos ({formatCount(batch.skipped)})
          </FilterBtn>
        )}
        <FilterBtn cur={filter} v="error" set={setFilter}>
          Errores ({formatCount(batch.error)})
        </FilterBtn>
      </div>
      {rows.length === 0 ? (
        <div className="tp-jempty faint">Nada que mostrar</div>
      ) : (
        <div className="tp-jscroll" style={{ height }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW_H, position: "relative" }}>
            {rows.slice(first, last).map((j, i) => (
              <JobRow key={j.id} j={j} top={(first + i) * ROW_H} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBtn({ cur, v, set, children }: { cur: Filter; v: Filter; set: (f: Filter) => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={cur === v} className={`tp-filter${cur === v ? " tp-on" : ""}`} onClick={() => set(v)}>
      {children}
    </button>
  );
}

function JobIcon({ s }: { s: TransferStatus }) {
  switch (s) {
    case "running":
      return <Loader2 size={13} className="tp-spin tp-ji-running" />;
    case "done":
      return <Check size={13} className="tp-ji-done" />;
    case "error":
      return <CircleAlert size={13} className="tp-ji-error" />;
    case "paused":
      return <Pause size={13} className="tp-ji-paused" />;
    case "queued":
      return <Clock size={13} className="tp-ji-queued" />;
    case "skipped":
      return <CircleMinus size={13} className="tp-ji-skipped" />;
    default:
      return <X size={13} className="tp-ji-canceled" />;
  }
}

const JobRow = memo(function JobRow({ j, top }: { j: TransferJob; top: number }) {
  const showProgress = j.status === "running" || j.status === "paused" || (j.status === "error" && j.transferred > 0);
  const p = j.size > 0 ? (j.transferred / j.size) * 100 : 0;
  const path = j.direction === "upload" ? j.remotePath : j.localPath;
  return (
    <div className={`tp-job tp-job-${j.status}`} style={{ top, height: ROW_H }} title={`${JOB_STATUS_LABEL[j.status]} · ${path}`}>
      <JobIcon s={j.status} />
      <span className="tp-jname tp-ellipsis mono">{j.name}</span>
      {j.status === "error" ? (
        <span className="tp-jerr tp-ellipsis" title={j.error ?? ""}>
          {j.error ?? "Error"}
        </span>
      ) : j.status === "skipped" ? (
        <span className="tp-jnote tp-ellipsis" title={skippedText(j)}>
          {skippedText(j)}
        </span>
      ) : (
        <span className="tp-jinfo">
          {showProgress && (
            <span className="tp-jbar">
              <Bar value={p} status={j.status} />
            </span>
          )}
          <span className="mono muted">
            {showProgress ? `${formatBytes(j.transferred)} / ${formatBytes(j.size)}` : formatBytes(j.size)}
          </span>
          {j.status === "running" && j.speed > 0 && <span className="mono">{formatSpeed(j.speed)}</span>}
          {j.status === "queued" && j.error && <span className="tp-jnote tp-ellipsis">{j.error}</span>}
        </span>
      )}
      <span className="tp-jactions">
        {(j.status === "running" || j.status === "queued") && (
          <IconBtn title="Pausar" onClick={() => pauseIds([j.id])}>
            <Pause size={12} />
          </IconBtn>
        )}
        {j.status === "paused" && (
          <IconBtn title="Reanudar" onClick={() => resumeIds([j.id])}>
            <Play size={12} />
          </IconBtn>
        )}
        {j.status === "error" && (
          <IconBtn title="Reintentar" onClick={() => retryIds([j.id])}>
            <RotateCcw size={12} />
          </IconBtn>
        )}
        {(j.status === "running" || j.status === "queued" || j.status === "paused" || j.status === "error") && (
          <IconBtn title="Cancelar" danger onClick={() => act(() => transfers.cancel([j.id]), "cancelar")}>
            <X size={12} />
          </IconBtn>
        )}
      </span>
    </div>
  );
});
