// Barra/panel de transferencias en la parte inferior: plegada o desplegada por lotes.
// Auxiliares en TransferHelpers.tsx y lista de trabajos en TransferJobs.tsx.
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Eraser, Loader2, Pause, Play, RotateCcw, X } from "lucide-react";
import { transfers } from "../../api/transfers";
import { formatBytes, formatSpeed } from "../../lib/format";
import { useTabs } from "../../stores/tabs";
import { formatCount, isActiveStatus, tickTransfers, useTransfers, type BatchSummary } from "../../stores/transfers";
import { ConflictDialog } from "./ConflictDialog";
import {
  act,
  aggregate,
  Bar,
  cancelBatches,
  DirIcon,
  etaText,
  IconBtn,
  loadExpanded,
  pauseIds,
  pct,
  resumeIds,
  retryIds,
  saveExpanded,
  StatusBadge,
} from "./TransferHelpers";
import { JobList } from "./TransferJobs";
import "./TransferPanel.css";
import "./TransferBatch.css";
import "./TransferJobs.css";
import "./TransferConflict.css";

export function TransferPanel() {
  const [expanded, setExpanded] = useState(loadExpanded);
  const order = useTransfers((s) => s.batchOrder);
  const batches = useTransfers((s) => s.batches);
  const list = useMemo(() => order.map((id) => batches[id]).filter((b): b is BatchSummary => !!b), [order, batches]);
  const anyRunning = list.some((b) => b.status === "running");

  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => {
      if (!document.hidden) tickTransfers();
    }, 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const toggle = (v: boolean) => {
    setExpanded(v);
    saveExpanded(v);
  };

  return (
    <section className={`tp-root${expanded ? " tp-expanded" : ""}`} aria-label="Transferencias">
      {expanded ? <ExpandedView list={list} onCollapse={() => toggle(false)} /> : <CollapsedBar list={list} onExpand={() => toggle(true)} />}
      <ConflictDialog />
    </section>
  );
}

function CollapsedBar({ list, onExpand }: { list: BatchSummary[]; onExpand: () => void }) {
  const active = list.filter((b) => isActiveStatus(b.status));
  const paused = list.filter((b) => b.status === "paused");
  const withErrors = list.filter((b) => b.error > 0).length;

  let body: ReactNode;
  if (active.length > 0 || paused.length > 0) {
    const shown = active.length > 0 ? active : paused;
    const isPaused = active.length === 0;
    const ag = aggregate(shown);
    const one = shown.length === 1 ? shown[0] : null;
    const dir = one ? one.direction : shown.every((b) => b.direction === "upload") ? "upload" : shown.every((b) => b.direction === "download") ? "download" : null;
    const title = one
      ? `${isPaused ? "En pausa:" : one.direction === "upload" ? "Subiendo" : "Descargando"} ${one.label}`
      : `${shown.length} transferencias${isPaused ? " en pausa" : ""}`;
    body = (
      <>
        <span className="tp-c-title">
          {dir ? <DirIcon dir={dir} /> : <Loader2 size={14} className="tp-spin" />}
          <span className="tp-ellipsis">{title}</span>
        </span>
        <span className="tp-c-count mono">
          {formatCount(ag.finished)} / {formatCount(ag.total)}
        </span>
        <Bar value={pct(ag)} status={isPaused ? "paused" : "running"} />
        {!isPaused && <span className="tp-c-speed mono">{formatSpeed(ag.speed)}</span>}
        {!isPaused && <span className="tp-c-eta muted">{etaText(ag.eta)}</span>}
        {withErrors > 0 && (
          <span className="tp-c-err" title="Hay archivos con errores">
            <CircleAlert size={13} /> {withErrors}
          </span>
        )}
        <span className="tp-c-actions">
          {isPaused ? (
            <IconBtn title="Reanudar" onClick={() => resumeIds(shown.map((b) => b.id))}>
              <Play size={14} />
            </IconBtn>
          ) : (
            <IconBtn title="Pausar" onClick={() => pauseIds(shown.map((b) => b.id))}>
              <Pause size={14} />
            </IconBtn>
          )}
          <IconBtn title="Cancelar" danger onClick={() => void cancelBatches(shown)}>
            <X size={14} />
          </IconBtn>
        </span>
      </>
    );
  } else {
    body = (
      <span className="tp-c-idle">
        <ArrowUp size={13} className="tp-idle-ico" />
        <ArrowDown size={13} className="tp-idle-ico" />
        <span>Sin transferencias</span>
        {list.length > 0 && (
          <span className="faint">
            · {formatCount(list.length)} en el historial
            {withErrors > 0 && (
              <>
                {" · "}
                <span className="tp-err-text">{formatCount(withErrors)} con errores</span>
              </>
            )}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      className="tp-collapsed"
      role="button"
      tabIndex={0}
      title="Ver transferencias"
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      {body}
      <span className="tp-c-chevron">
        <ChevronUp size={14} />
      </span>
    </div>
  );
}

function ExpandedView({ list, onCollapse }: { list: BatchSummary[]; onCollapse: () => void }) {
  const tabs = useTabs((s) => s.tabs);
  const serverNames = useMemo(() => new Map(tabs.map((t) => [t.sessionId, t.title])), [tabs]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const onToggle = useCallback((id: string) => setOpen((o) => ({ ...o, [id]: !o[id] })), []);

  const active = list.filter((b) => isActiveStatus(b.status));
  const paused = list.filter((b) => b.status === "paused");
  const ag = aggregate(active);
  const newestFirst = useMemo(() => [...list].reverse(), [list]);

  const clear = () => act(() => transfers.clearFinished(), "limpiar la lista");

  return (
    <>
      <header className="tp-head">
        <span className="section-label">Transferencias</span>
        <span className="tp-head-sum muted">
          {active.length > 0
            ? `${formatCount(ag.finished)} / ${formatCount(ag.total)} archivos · ${formatSpeed(ag.speed)}${ag.eta !== null ? ` · ${etaText(ag.eta)}` : ""}`
            : list.length > 0
              ? "Nada en curso"
              : ""}
        </span>
        <span className="tp-head-actions">
          {active.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => pauseIds(active.map((b) => b.id))}>
              <Pause size={13} /> Pausar todo
            </button>
          ) : paused.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => resumeIds(paused.map((b) => b.id))}>
              <Play size={13} /> Reanudar todo
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            disabled={!list.some((b) => b.done + b.skipped + b.error + b.canceled > 0)}
            onClick={clear}
            title="Quitar de la lista lo completado, omitido, cancelado o con error"
          >
            <Eraser size={13} /> Limpiar terminados
          </button>
          <button type="button" className="icon-btn" title="Plegar" aria-label="Plegar" onClick={onCollapse}>
            <ChevronDown size={16} />
          </button>
        </span>
      </header>
      <div className="tp-body">
        {newestFirst.length === 0 ? (
          <div className="tp-empty">
            <ArrowUp size={16} />
            <ArrowDown size={16} />
            <span>Sin transferencias. Arrastra archivos o carpetas al explorador para subirlos.</span>
          </div>
        ) : (
          newestFirst.map((b) => (
            <BatchRow key={b.id} b={b} server={serverNames.get(b.sessionId) ?? "Conexión cerrada"} open={!!open[b.id]} onToggle={onToggle} />
          ))
        )}
      </div>
    </>
  );
}

const BatchRow = memo(function BatchRow({ b, server, open, onToggle }: { b: BatchSummary; server: string; open: boolean; onToggle: (id: string) => void }) {
  const active = isActiveStatus(b.status);
  const counted = b.total - b.canceled - b.skipped;
  return (
    <div className={`tp-batch${open ? " tp-open" : ""}`}>
      <div
        className="tp-brow"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => onToggle(b.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(b.id);
          }
        }}
      >
        <span className="tp-caret">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <DirIcon dir={b.direction} />
        <span className="tp-blabel">
          <span className="tp-ellipsis tp-bname" title={b.label}>
            {b.label}
          </span>
          <span className="tp-ellipsis tp-server faint" title={server}>
            {b.direction === "upload" ? "→" : "←"} {server}
          </span>
        </span>
        <span className="tp-bcount mono" title="Archivos terminados / total">
          {formatCount(b.done)} / {formatCount(counted)}
          {b.skipped > 0 && (
            <span className="tp-skip-text" title="Omitidos: ya existían en el destino">
              {" "}
              · {formatCount(b.skipped)} omit.
            </span>
          )}
          {b.error > 0 && <span className="tp-err-text"> · {formatCount(b.error)} ✕</span>}
        </span>
        <span className="tp-bbytes mono muted">
          {formatBytes(b.bytesDone)} / {formatBytes(b.bytesTotal)}
        </span>
        <span className="tp-bprog">
          <Bar value={pct(b)} status={b.status} />
        </span>
        <span className="tp-bspeed mono">{b.status === "running" ? formatSpeed(b.speed) : ""}</span>
        <span className="tp-beta muted">{b.status === "running" ? etaText(b.eta) : ""}</span>
        <StatusBadge s={b.status} />
        <span className="tp-bactions">
          {active && (
            <IconBtn title="Pausar" onClick={() => pauseIds([b.id])}>
              <Pause size={14} />
            </IconBtn>
          )}
          {b.status === "paused" && (
            <IconBtn title="Reanudar" onClick={() => resumeIds([b.id])}>
              <Play size={14} />
            </IconBtn>
          )}
          {b.error > 0 && (
            <IconBtn title="Reintentar los fallidos" onClick={() => retryIds([b.id])}>
              <RotateCcw size={14} />
            </IconBtn>
          )}
          {(active || b.status === "paused") && (
            <IconBtn title="Cancelar" danger onClick={() => void cancelBatches([b])}>
              <X size={14} />
            </IconBtn>
          )}
        </span>
      </div>
      {!open && b.firstError && (
        <div className="tp-berror tp-ellipsis" title={b.firstError}>
          <CircleAlert size={12} /> {b.firstError}
        </div>
      )}
      {open && <JobList batch={b} />}
    </div>
  );
});
