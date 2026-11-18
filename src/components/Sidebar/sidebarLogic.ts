// Barra lateral (funciones puras): estado de las pestañas por servidor, búsqueda, claves de filas
// y navegación con flechas.
import type { Bookmark, Project, ServerProfile } from "../../api/types";

export type TabState = "connected" | "reconnecting" | "closed";
const TAB_STATE_RANK: Record<TabState, number> = { closed: 1, reconnecting: 2, connected: 3 };

/** Estado de la mejor pestaña de cada servidor, como texto estable ("id:estado" por línea, ordenado):
 *  así cambiar de pestaña no redibuja la barra; solo abrir, cerrar o cambiar de estado. */
export function tabStatesKey(tabs: readonly { status: TabState; profileId: string }[]): string {
  const best = new Map<string, TabState>();
  for (const t of tabs) {
    const cur = best.get(t.profileId);
    if (!cur || TAB_STATE_RANK[t.status] > TAB_STATE_RANK[cur]) best.set(t.profileId, t.status);
  }
  return Array.from(best, ([id, st]) => `${id}:${st}`)
    .sort()
    .join("\n");
}

export function parseTabStates(key: string): Map<string, TabState> {
  const m = new Map<string, TabState>();
  for (const line of key ? key.split("\n") : []) {
    const i = line.lastIndexOf(":");
    m.set(line.slice(0, i), line.slice(i + 1) as TabState);
  }
  return m;
}

/** El servidor coincide con la búsqueda `q` (ya en minúsculas) por nombre, host o usuario. */
export function matchesServer(s: ServerProfile, q: string): boolean {
  return (
    s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q) || s.username.toLowerCase().includes(q)
  );
}

/** Servidores guardados del proyecto, en su orden (sin los que ya no existen). */
export function projectServers(p: Project, serverById: ReadonlyMap<string, ServerProfile>): ServerProfile[] {
  return p.serverIds.map((id) => serverById.get(id)).filter((s): s is ServerProfile => !!s);
}

export interface ProjectEntry {
  project: Project;
  servers: ServerProfile[];
  bookmarks: Bookmark[];
}

/** Proyectos que se ven con la búsqueda `q`: si el nombre del proyecto coincide, entero; si no,
 *  solo los servidores y marcadores que coinciden (y nada si no coincide ninguno). */
export function filterProjects(
  projects: readonly Project[],
  serverById: ReadonlyMap<string, ServerProfile>,
  q: string,
): ProjectEntry[] {
  return projects
    .map((p) => {
      const projServers = projectServers(p, serverById);
      if (!q || p.name.toLowerCase().includes(q)) return { project: p, servers: projServers, bookmarks: p.bookmarks };
      const ss = projServers.filter((s) => matchesServer(s, q));
      const bs = p.bookmarks.filter((b) => {
        const owner = serverById.get(b.serverId);
        return b.path.toLowerCase().includes(q) || (b.label ?? "").toLowerCase().includes(q) || (!!owner && matchesServer(owner, q));
      });
      if (ss.length === 0 && bs.length === 0) return null;
      return { project: p, servers: ss, bookmarks: bs };
    })
    .filter((x): x is ProjectEntry => x !== null);
}

/** Clave de la fila de un servidor (dentro de un proyecto o en «Servidores»). */
export function serverRowKey(serverId: string, projectId?: string): string {
  return projectId ? `p:${projectId}:s:${serverId}` : `s:${serverId}`;
}

export function bookmarkRowKey(projectId: string, b: Bookmark): string {
  return `b:${projectId}:${b.serverId}:${b.path}`;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isNavKey(key: string): boolean {
  return NAV_KEYS.has(key);
}

/** Fila a la que se mueve el foco con una tecla de navegación (`current` = -1 si ninguna tiene el foco). */
export function navIndex(key: string, current: number, count: number): number {
  if (key === "ArrowDown") return current < 0 ? 0 : Math.min(count - 1, current + 1);
  if (key === "ArrowUp") return current < 0 ? 0 : Math.max(0, current - 1);
  if (key === "End") return count - 1;
  return 0;
}

/** Ruta de un marcador nuevo: absoluta o desde el home. */
export function validateBookmarkPath(v: string): string | null {
  return v.trim().startsWith("/") || v.trim().startsWith("~") ? null : "Escribe una ruta absoluta (/…)";
}
