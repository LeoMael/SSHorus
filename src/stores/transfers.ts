// Transferencias: trabajos por id + resúmenes por lote calculados de forma incremental.
// DUEÑO: agente Transferencias.
//
// El motor envía cada ~200 ms solo los trabajos que cambiaron. Con miles de trabajos no se
// recalcula todo: cada actualización resta la contribución vieja del trabajo a su lote y
// suma la nueva (O(cambios)), y solo los lotes tocados reciben un objeto nuevo.
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  EV_TRANSFER_CONFLICT,
  EV_TRANSFER_CONFLICT_DONE,
  transfers,
  type TransferConflict,
} from "../api/transfers";
import { EV_TRANSFER_REMOVED, EV_TRANSFER_UPDATE, type TransferJob } from "../api/types";
import { toast } from "./toasts";
import {
  addJob,
  finishedToast,
  isActiveStatus,
  newAgg,
  refreshFirstError,
  summarize,
  type Agg,
  type BatchSummary,
} from "./transferBatch";

export { formatCount, isActiveStatus, type BatchStatus, type BatchSummary } from "./transferBatch";

interface TransfersState {
  jobs: Record<string, TransferJob>;
  /** Lotes en orden de creación (el más viejo primero). */
  batchOrder: string[];
  batches: Record<string, BatchSummary>;
  loaded: boolean;
}

export const useTransfers = create<TransfersState>(() => ({
  jobs: {},
  batchOrder: [],
  batches: {},
  loaded: false,
}));

/** Preguntas de conflicto pendientes ("Ya existe…"), en orden de llegada: se muestran de una en una. */
export const useTransferConflicts = create<{ queue: TransferConflict[] }>(() => ({ queue: [] }));

function addConflicts(list: TransferConflict[]) {
  if (list.length === 0) return;
  const queue = useTransferConflicts.getState().queue;
  const known = new Set(queue.map((q) => q.jobId));
  const fresh = list.filter((q) => !known.has(q.jobId));
  if (fresh.length > 0) useTransferConflicts.setState({ queue: [...queue, ...fresh] });
}

/** Quita preguntas ya respondidas (también las del mismo lote si se aplicó a todos). */
export function dropConflicts(jobIds: string[]) {
  if (jobIds.length === 0) return;
  const gone = new Set(jobIds);
  const queue = useTransferConflicts.getState().queue;
  const next = queue.filter((q) => !gone.has(q.jobId));
  if (next.length !== queue.length) useTransferConflicts.setState({ queue: next });
}

/** Ids de trabajos de un lote, en orden de llegada (no reactivo: usar junto a `version`). */
export function batchJobIds(batchId: string): readonly string[] {
  return aggs.get(batchId)?.jobIds ?? EMPTY;
}

const EMPTY: readonly string[] = [];
const aggs = new Map<string, Agg>();

// ───────────────────────── Avisos al terminar un lote ─────────────────────────

const pendingToasts = new Map<string, ReturnType<typeof setTimeout>>();

/** Espera un momento antes de avisar: una bajada recursiva puede seguir añadiendo archivos. */
function scheduleToast(batchId: string) {
  const prev = pendingToasts.get(batchId);
  if (prev) clearTimeout(prev);
  pendingToasts.set(
    batchId,
    setTimeout(() => {
      pendingToasts.delete(batchId);
      const a = aggs.get(batchId);
      if (!a || a.notified) return;
      const b = useTransfers.getState().batches[batchId];
      if (!b || isActiveStatus(b.status) || b.status === "paused") return;
      a.notified = true;
      a.wasActive = false;
      const t = finishedToast(b);
      if (t) toast[t.kind](t.title, t.body);
    }, 1200),
  );
}


// ───────────────────────── Aplicar eventos ─────────────────────────

function applyUpdate(list: TransferJob[], opts: { onlyNew?: boolean; silent?: boolean } = {}) {
  if (list.length === 0) return;
  const st = useTransfers.getState();
  const jobs = { ...st.jobs };
  const touched = new Set<string>();
  let order = st.batchOrder;
  for (const j of list) {
    const old = jobs[j.id];
    if (old && opts.onlyNew) continue;
    let a = aggs.get(j.batchId);
    if (!a) {
      a = newAgg(j);
      aggs.set(j.batchId, a);
      if (order === st.batchOrder) order = [...order];
      order.push(j.batchId);
      if (opts.silent) a.notified = true;
    }
    if (old) addJob(a, old, -1);
    else a.jobIds.push(j.id);
    addJob(a, j, 1);
    if (old?.status === "error" && j.status !== "error" && a.firstError === (old.error ?? "Error")) a.firstError = null;
    jobs[j.id] = j;
    touched.add(j.batchId);
  }
  if (touched.size === 0) return;
  const now = Date.now();
  const batches = { ...st.batches };
  for (const id of touched) {
    const a = aggs.get(id);
    if (!a) continue;
    a.version++;
    refreshFirstError(a, jobs);
    const s = summarize(a, now);
    batches[id] = s;
    const active = isActiveStatus(s.status);
    if (active) {
      a.wasActive = true;
      a.notified = false;
      const p = pendingToasts.get(id);
      if (p) {
        clearTimeout(p);
        pendingToasts.delete(id);
      }
    } else if (a.wasActive && !a.notified && s.status !== "paused") {
      scheduleToast(id);
    }
  }
  useTransfers.setState({ jobs, batches, batchOrder: order });
}

function applyRemoved(ids: string[]) {
  if (ids.length === 0) return;
  const st = useTransfers.getState();
  const jobs = { ...st.jobs };
  const touched = new Set<string>();
  for (const id of ids) {
    const j = jobs[id];
    if (!j) continue;
    const a = aggs.get(j.batchId);
    if (a) {
      addJob(a, j, -1);
      touched.add(j.batchId);
    }
    delete jobs[id];
  }
  if (touched.size === 0) return;
  const removedSet = new Set(ids);
  const batches = { ...st.batches };
  let order = st.batchOrder;
  const now = Date.now();
  for (const bid of touched) {
    const a = aggs.get(bid);
    if (!a) continue;
    a.jobIds = a.jobIds.filter((x) => !removedSet.has(x));
    if (a.jobIds.length === 0) {
      aggs.delete(bid);
      delete batches[bid];
      order = order.filter((x) => x !== bid);
      continue;
    }
    a.version++;
    a.firstError = null;
    refreshFirstError(a, jobs);
    batches[bid] = summarize(a, now);
  }
  useTransfers.setState({ jobs, batches, batchOrder: order });
}

/**
 * Recalcula velocidades/ETA de los lotes en marcha aunque no lleguen eventos
 * (si una transferencia se atasca, la velocidad debe bajar). Lo llama el panel cada segundo.
 */
export function tickTransfers() {
  const st = useTransfers.getState();
  const now = Date.now();
  let batches: Record<string, BatchSummary> | null = null;
  for (const id of st.batchOrder) {
    const b = st.batches[id];
    const a = aggs.get(id);
    if (!a || !b || b.status !== "running") continue;
    const s = summarize(a, now);
    if (Math.abs(s.speed - b.speed) > 1 || s.eta !== b.eta) {
      batches ??= { ...st.batches };
      batches[id] = s;
    }
  }
  if (batches) useTransfers.setState({ batches });
}

let initPromise: Promise<void> | null = null;

/** Llamar una vez al iniciar la app: carga la lista y escucha eventos. */
export function initTransfersStore(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await listen<TransferJob[]>(EV_TRANSFER_UPDATE, (e) => applyUpdate(e.payload));
      await listen<string[]>(EV_TRANSFER_REMOVED, (e) => applyRemoved(e.payload));
      await listen<TransferConflict>(EV_TRANSFER_CONFLICT, (e) => addConflicts([e.payload]));
      await listen<string[]>(EV_TRANSFER_CONFLICT_DONE, (e) => dropConflicts(e.payload));
      const list = await transfers.list();
      // Lo que ya llegó por eventos es más nuevo que la lista: solo se añaden los que faltan.
      applyUpdate(list, { onlyNew: true, silent: true });
      addConflicts(await transfers.conflicts());
    } catch (err) {
      console.error("No se pudieron cargar las transferencias", err);
    } finally {
      useTransfers.setState({ loaded: true });
    }
  })();
  return initPromise;
}
