// Resumen por usuario del Monitor: cuánta CPU y memoria usa cada uno, cuántos procesos y contenedores
// tiene en marcha. Funciones puras a partir de las filas de procesos.
import type { ProcRow } from "./derive";

export interface UserUsage {
  /** null = aún no se sabe de quién es. */
  uid: number | null;
  user: string;
  /** % del CPU de todo el servidor (todos los núcleos = 100 %). null si aún no hay dato. */
  cpuPct: number | null;
  rssKb: number;
  memPct: number | null;
  procs: number;
  /** Contenedores en marcha (un `conmon` o `containerd-shim` por contenedor, del usuario que lo lanzó). */
  containers: number;
}

/** El proceso que acompaña a cada contenedor (podman: conmon; docker: containerd-shim, nombre recortado). */
const CONTAINER_MONITOR = /^(conmon|containerd-shim)/;

export function summarizeUsers(rows: ProcRow[], nproc: number | null, memTotalKb: number | null): UserUsage[] {
  const by = new Map<string, UserUsage & { cpuSum: number; cpuKnown: boolean }>();
  for (const r of rows) {
    const key = r.uid === null ? "?" : String(r.uid);
    let u = by.get(key);
    if (!u) {
      u = { uid: r.uid, user: r.user ?? "…", cpuPct: null, rssKb: 0, memPct: null, procs: 0, containers: 0, cpuSum: 0, cpuKnown: false };
      by.set(key, u);
    }
    u.procs++;
    u.rssKb += r.rssKb ?? 0;
    if (r.cpuPct !== null) {
      u.cpuSum += r.cpuPct;
      u.cpuKnown = true;
    }
    if (CONTAINER_MONITOR.test(r.comm)) u.containers++;
  }
  const cores = nproc && nproc > 0 ? nproc : 1;
  return [...by.values()]
    .map(({ cpuSum, cpuKnown, ...u }) => ({
      ...u,
      cpuPct: cpuKnown ? Math.min(100, cpuSum / cores) : null,
      memPct: memTotalKb ? (u.rssKb / memTotalKb) * 100 : null,
    }))
    // Por memoria: cambia menos que la CPU entre muestras y la lista no baila.
    .sort((a, b) => b.rssKb - a.rssKb || a.user.localeCompare(b.user));
}

/** Los procesos de un usuario (`uid` null = todos). */
export function filterByUser(rows: ProcRow[], uid: number | null): ProcRow[] {
  return uid === null ? rows : rows.filter((r) => r.uid === uid);
}

/**
 * Qué procesos se ven. «own»: /proc tiene hidepid y no eres root ni se leyó con sudo, así que solo ves los
 * tuyos. Si aun así se ven de otros usuarios (hidepid con un grupo que lo permite), es «all».
 */
export type ProcScope = "all" | "all-sudo" | "own";

export function procScope(hidepid: boolean, myUid: number | null, elevated: boolean, users: UserUsage[]): ProcScope {
  if (!hidepid || myUid === 0) return "all";
  if (elevated) return "all-sudo";
  return users.some((u) => u.uid !== null && u.uid !== myUid) ? "all" : "own";
}
