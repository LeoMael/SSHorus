// Resumen por usuario del Monitor: cuánta CPU y memoria usa cada uno, cuántos procesos y contenedores
// tiene en marcha. Funciones puras a partir de las filas de procesos.
import type { ProcRow } from "./derive";
import type { ContainerEngine } from "./containerUids";

/** Contenedor en el que corren procesos de un usuario. */
export interface UserContainer {
  id: string;
  name: string | null;
  engine: ContainerEngine;
  /** Dueño del contenedor (null si no se sabe). */
  owner: string | null;
}

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
  /** uid de un rango de /etc/subuid: es el usuario `innerUid` de dentro de contenedores de `owner`. */
  sub: { owner: string; innerUid: number } | null;
  /** Contenedores en los que corren sus procesos (los que ya se conocen). */
  inContainers: UserContainer[];
}

/** El proceso que acompaña a cada contenedor (podman: conmon; docker: containerd-shim, nombre recortado). */
const CONTAINER_MONITOR = /^(conmon|containerd-shim)/;

export function summarizeUsers(rows: ProcRow[], nproc: number | null, memTotalKb: number | null): UserUsage[] {
  const by = new Map<string, UserUsage & { cpuSum: number; cpuKnown: boolean }>();
  for (const r of rows) {
    const key = r.uid === null ? "?" : String(r.uid);
    let u = by.get(key);
    if (!u) {
      u = {
        uid: r.uid,
        user: r.user ?? "…",
        cpuPct: null,
        rssKb: 0,
        memPct: null,
        procs: 0,
        containers: 0,
        sub: null,
        inContainers: [],
        cpuSum: 0,
        cpuKnown: false,
      };
      by.set(key, u);
    }
    const c = r.container;
    if (c?.owner && c.innerUid !== null && !u.sub) u.sub = { owner: c.owner, innerUid: c.innerUid };
    if (c?.id && c.engine && !u.inContainers.some((x) => x.id === c.id)) {
      u.inContainers.push({ id: c.id, name: c.name, engine: c.engine, owner: c.owner });
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
  const list = [...by.values()]
    .map(({ cpuSum, cpuKnown, ...u }) => ({
      ...u,
      cpuPct: cpuKnown ? Math.min(100, cpuSum / cores) : null,
      memPct: memTotalKb ? (u.rssKb / memTotalKb) * 100 : null,
    }))
    // Por memoria: cambia menos que la CPU entre muestras y la lista no baila.
    .sort((a, b) => b.rssKb - a.rssKb || a.user.localeCompare(b.user))
    .map((u) => ({ ...u, inContainers: [...u.inContainers].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)) }));
  return groupUsersByOwner(list);
}

/**
 * Cada usuario seguido de los uid de sus contenedores (los de /etc/subuid), y los grupos por la memoria
 * de todo el grupo. Dentro del grupo, el dueño primero y sus contenedores por memoria.
 */
export function groupUsersByOwner(users: UserUsage[]): UserUsage[] {
  const family = (u: UserUsage) => u.sub?.owner ?? u.user;
  const total = new Map<string, number>();
  for (const u of users) total.set(family(u), (total.get(family(u)) ?? 0) + u.rssKb);
  // `users` ya viene por memoria: el orden estable conserva eso dentro de cada grupo.
  return [...users].sort((a, b) => {
    const fa = family(a);
    const fb = family(b);
    if (fa !== fb) return total.get(fb)! - total.get(fa)! || fa.localeCompare(fb);
    return Number(!!a.sub) - Number(!!b.sub);
  });
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
