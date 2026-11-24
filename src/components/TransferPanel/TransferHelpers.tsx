// Utilidades y piezas pequeñas del panel de transferencias (acciones, progreso, etiquetas e iconos).
import type { MouseEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, CircleAlert, Clock, Loader2, Pause, X } from "lucide-react";
import { transfers } from "../../api/transfers";
import type { TransferJob, TransferStatus } from "../../api/types";
import { formatDuration } from "../../lib/format";
import { confirmDialog } from "../ui/dialogs";
import { toast } from "../../stores/toasts";
import { formatCount, type BatchStatus, type BatchSummary } from "../../stores/transfers";

const EXPANDED_KEY = "sshorus.transfers.expanded";

export function loadExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveExpanded(v: boolean) {
  try {
    localStorage.setItem(EXPANDED_KEY, v ? "1" : "0");
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function act(fn: () => Promise<void>, what: string) {
  fn().catch((e) => toast.error(`No se pudo ${what}`, e));
}

export const pauseIds = (ids: string[]) => act(() => transfers.pause(ids), "pausar");
export const resumeIds = (ids: string[]) => act(() => transfers.resume(ids), "reanudar");
export const retryIds = (ids: string[]) => act(() => transfers.retry(ids), "reintentar");

export async function cancelBatches(list: BatchSummary[]) {
  const pending = list.reduce((n, b) => n + b.running + b.queued + b.paused, 0);
  if (pending > 1) {
    const ok = await confirmDialog({
      title: list.length > 1 ? "¿Cancelar las transferencias?" : "¿Cancelar la transferencia?",
      message: `Quedan ${formatCount(pending)} archivos pendientes. Los archivos a medio copiar se borrarán; los ya terminados se conservan.`,
      confirmText: "Cancelar transferencia",
      cancelText: "Seguir",
      danger: true,
    });
    if (!ok) return;
  }
  act(() => transfers.cancel(list.map((b) => b.id)), "cancelar");
}

export function pct(b: { bytesDone: number; bytesTotal: number; done: number; skipped: number; total: number; canceled: number }) {
  if (b.bytesTotal > 0) return Math.min(100, (b.bytesDone / b.bytesTotal) * 100);
  const t = b.total - b.canceled;
  return t > 0 ? ((b.done + b.skipped) / t) * 100 : 0;
}

export function skippedText(j: TransferJob) {
  return `Omitido: ${j.error ?? "ya existía"}`;
}

export function etaText(eta: number | null) {
  return eta === null ? "" : `~${formatDuration(eta)}`;
}

export function aggregate(list: BatchSummary[]) {
  let total = 0;
  let finished = 0;
  let bytesTotal = 0;
  let bytesDone = 0;
  let speed = 0;
  let canceled = 0;
  let done = 0;
  let skipped = 0;
  for (const b of list) {
    total += b.total;
    finished += b.done + b.skipped + b.error + b.canceled;
    done += b.done;
    skipped += b.skipped;
    canceled += b.canceled;
    bytesTotal += b.bytesTotal;
    bytesDone += b.bytesDone;
    speed += b.speed;
  }
  const eta = speed > 1 ? Math.max(0, bytesTotal - bytesDone) / speed : null;
  return { total, finished, bytesTotal, bytesDone, speed, eta, done, skipped, canceled };
}

export const STATUS_LABEL: Record<BatchStatus, string> = {
  running: "En curso",
  queued: "En cola",
  paused: "En pausa",
  done: "Completado",
  error: "Con errores",
  canceled: "Cancelado",
};

export const JOB_STATUS_LABEL: Record<TransferStatus, string> = {
  running: "En curso",
  queued: "En cola",
  paused: "En pausa",
  done: "Completado",
  skipped: "Omitido",
  error: "Error",
  canceled: "Cancelado",
};

export function DirIcon({ dir, size = 14 }: { dir: "upload" | "download"; size?: number }) {
  return dir === "upload" ? (
    <ArrowUp size={size} className="tp-dir tp-dir-up" aria-label="Subida" />
  ) : (
    <ArrowDown size={size} className="tp-dir tp-dir-down" aria-label="Descarga" />
  );
}

export function Bar({ value, status }: { value: number; status?: BatchStatus | TransferStatus }) {
  return (
    <div className={`progress tp-bar${status ? ` tp-bar-${status}` : ""}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function IconBtn({ title, onClick, children, danger }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn tp-ibtn${danger ? " tp-danger" : ""}`}
      title={title}
      aria-label={title}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ s }: { s: BatchStatus }) {
  const icon =
    s === "running" ? <Loader2 size={12} className="tp-spin" />
    : s === "done" ? <Check size={12} />
    : s === "error" ? <CircleAlert size={12} />
    : s === "paused" ? <Pause size={12} />
    : s === "queued" ? <Clock size={12} />
    : <X size={12} />;
  return (
    <span className={`tp-badge tp-badge-${s}`}>
      {icon}
      {STATUS_LABEL[s]}
    </span>
  );
}
