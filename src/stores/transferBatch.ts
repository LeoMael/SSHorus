// Resumen de un lote de transferencias, calculado de forma incremental (sin React ni Tauri).
//
// Cada trabajo suma su «contribución» al agregado de su lote; al cambiar, se resta la vieja y se
// suma la nueva (O(cambios) aunque el lote tenga miles de trabajos).
import type { TransferDirection, TransferJob, TransferStatus } from "../api/types";

export type BatchStatus = "running" | "queued" | "paused" | "done" | "error" | "canceled";

export interface BatchSummary {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  /** "fotos/", "informe.pdf" o "fotos/ y 2 más". */
  label: string;
  total: number;
  done: number;
  /** No se transfirieron por la política de conflictos (ya existían). */
  skipped: number;
  error: number;
  canceled: number;
  running: number;
  queued: number;
  paused: number;
  /** Bytes de los trabajos no cancelados ni omitidos. */
  bytesTotal: number;
  bytesDone: number;
  /** Bytes/s (ventana reciente del lote completo). */
  speed: number;
  /** Segundos restantes estimados (null si no se sabe). */
  eta: number | null;
  status: BatchStatus;
  createdAt: number;
  /** Primer error (para mostrarlo sin abrir el lote). */
  firstError: string | null;
  /** Cambia cada vez que cambia algún trabajo del lote (para memorizar listas). */
  version: number;
}

export function isActiveStatus(s: BatchStatus | TransferStatus): boolean {
  return s === "running" || s === "queued";
}

/** 2000 → "2.000" (agrupa también números de 4 cifras). */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const SPEED_WINDOW_MS = 4000;

export interface Agg {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  createdAt: number;
  jobIds: string[];
  /** posición de cada id en jobIds no hace falta: el borrado reconstruye la lista */
  counts: Record<TransferStatus, number>;
  bytesTotal: number;
  bytesDone: number;
  /** raíz → nº de trabajos (en orden de aparición). */
  roots: Map<string, number>;
  errors: number;
  firstError: string | null;
  samples: { t: number; b: number }[];
  /** Suma de velocidades de los trabajos en marcha (respaldo al empezar). */
  jobSpeed: number;
  version: number;
  wasActive: boolean;
  notified: boolean;
}

/** Primer tramo del nombre relativo ("fotos/" de "fotos/a.png"). Acepta "\\" por si el
 *  nombre se formó a partir de una ruta local de Windows. */
export function rootOf(name: string): string {
  const i = name.search(/[\\/]/);
  return i < 0 ? name : name.slice(0, i + 1);
}

function contribution(j: TransferJob) {
  // Cancelados y omitidos no cuentan en los bytes del lote.
  const excluded = j.status === "canceled" || j.status === "skipped";
  return {
    total: excluded ? 0 : j.size,
    done: excluded ? 0 : j.status === "done" ? j.size : Math.min(j.transferred, j.size || j.transferred),
    speed: j.status === "running" ? j.speed : 0,
  };
}

export function newAgg(j: TransferJob): Agg {
  return {
    id: j.batchId,
    sessionId: j.sessionId,
    direction: j.direction,
    createdAt: j.createdAt,
    jobIds: [],
    counts: { queued: 0, running: 0, paused: 0, done: 0, skipped: 0, error: 0, canceled: 0 },
    bytesTotal: 0,
    bytesDone: 0,
    roots: new Map(),
    errors: 0,
    firstError: null,
    samples: [],
    jobSpeed: 0,
    version: 0,
    wasActive: false,
    notified: false,
  };
}

/** Suma (`sign` = 1) o resta (`sign` = -1) un trabajo del agregado de su lote. */
export function addJob(a: Agg, j: TransferJob, sign: 1 | -1) {
  const c = contribution(j);
  a.counts[j.status] += sign;
  a.bytesTotal += sign * c.total;
  a.bytesDone += sign * c.done;
  a.jobSpeed += sign * c.speed;
  if (j.status === "error") a.errors += sign;
  const r = rootOf(j.name);
  const n = (a.roots.get(r) ?? 0) + sign;
  if (n <= 0) a.roots.delete(r);
  else a.roots.set(r, n);
}

function statusOf(a: Agg): BatchStatus {
  const c = a.counts;
  if (c.running > 0) return "running";
  if (c.queued > 0) return "queued";
  if (c.paused > 0) return "paused";
  if (c.error > 0) return "error";
  if (c.done > 0 || c.skipped > 0) return "done";
  return "canceled";
}

function labelOf(a: Agg): string {
  let first = "";
  for (const k of a.roots.keys()) {
    first = k;
    break;
  }
  const more = a.roots.size - 1;
  return more > 0 ? `${first} y ${more} más` : first || "—";
}

/** Velocidad por ventana deslizante sobre los bytes del lote. */
function sampleSpeed(a: Agg, now: number, active: boolean): number {
  if (!active) {
    a.samples = [];
    return 0;
  }
  const s = a.samples;
  const last = s[s.length - 1];
  if (!last || last.b !== a.bytesDone || now - last.t > 400) s.push({ t: now, b: a.bytesDone });
  while (s.length > 2 && now - s[0].t > SPEED_WINDOW_MS) s.shift();
  const first = s[0];
  const span = now - first.t;
  if (span < 600) return Math.max(0, a.jobSpeed);
  return Math.max(0, ((a.bytesDone - first.b) * 1000) / span);
}

export function summarize(a: Agg, now: number): BatchSummary {
  const c = a.counts;
  const status = statusOf(a);
  const total = c.queued + c.running + c.paused + c.done + c.skipped + c.error + c.canceled;
  const speed = sampleSpeed(a, now, status === "running");
  const remaining = Math.max(0, a.bytesTotal - a.bytesDone);
  return {
    id: a.id,
    sessionId: a.sessionId,
    direction: a.direction,
    label: labelOf(a),
    total,
    done: c.done,
    skipped: c.skipped,
    error: c.error,
    canceled: c.canceled,
    running: c.running,
    queued: c.queued,
    paused: c.paused,
    bytesTotal: a.bytesTotal,
    bytesDone: a.bytesDone,
    speed,
    eta: speed > 1 && status === "running" ? remaining / speed : null,
    status,
    createdAt: a.createdAt,
    firstError: a.firstError,
    version: a.version,
  };
}

export function refreshFirstError(a: Agg, jobs: Record<string, TransferJob>) {
  if (a.errors <= 0) {
    a.firstError = null;
    return;
  }
  if (a.firstError !== null) return;
  for (const id of a.jobIds) {
    const j = jobs[id];
    if (j?.status === "error") {
      a.firstError = j.error ?? "Error";
      return;
    }
  }
}

function verb(d: TransferDirection, done: boolean) {
  if (d === "upload") return done ? "Subida completada" : "Subida con errores";
  return done ? "Descarga completada" : "Descarga con errores";
}

function plural(n: number, one: string, many: string) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Texto del aviso al terminar un lote (null si no hay nada que avisar: todo cancelado). */
export function finishedToast(b: BatchSummary): { kind: "error" | "success"; title: string; body: string } | null {
  const skipped = b.skipped > 0 ? ` · ${formatCount(b.skipped)} ${b.skipped === 1 ? "omitido" : "omitidos"}` : "";
  if (b.error > 0) {
    return {
      kind: "error",
      title: verb(b.direction, false),
      body: `${b.label}: fallaron ${formatCount(b.error)} de ${plural(b.total - b.canceled, "archivo", "archivos")}${skipped}`,
    };
  }
  if (b.done > 0 || b.skipped > 0) {
    return { kind: "success", title: verb(b.direction, true), body: `${b.label} · ${plural(b.done, "archivo", "archivos")}${skipped}` };
  }
  return null;
}
