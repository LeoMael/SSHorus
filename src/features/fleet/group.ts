// Panel de VPS: agrupa los servidores guardados por máquina (mismo host y puerto = un VPS) y los ordena
// por proyecto o por IP. Funciones puras (sin React ni Tauri).
import type { Project, ServerProfile } from "../../api/types";

export interface Vps {
  /** "host:puerto" en minúsculas (identifica el VPS). */
  key: string;
  host: string;
  port: number;
  /** El nombre común de sus servidores guardados o, si no lo hay, el host. */
  name: string;
  /** Usuarios guardados de este VPS (en el orden de la lista de servidores). */
  profiles: ServerProfile[];
  /** Proyectos que tienen alguno de sus servidores. */
  projectIds: string[];
}

export type FleetGroupBy = "project" | "ip";

export interface FleetSection {
  /** id del proyecto, "" = sin proyecto; "all" en la vista por IP. */
  id: string;
  title: string;
  color: string | null;
  vps: Vps[];
}

export function vpsKey(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}

/** Palabras iniciales que comparten todos los nombres («web prod» y «web dev» → «web»). */
function commonName(names: string[]): string | null {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return uniq[0];
  const words = uniq.map((n) => n.split(/[\s·_\-–()[\]@]+/).filter(Boolean));
  const out: string[] = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (!words.every((ws) => ws[i]?.toLowerCase() === w.toLowerCase())) break;
    out.push(w);
  }
  const joined = out.join(" ");
  return joined.length >= 3 ? joined : null;
}

/** Un VPS por cada host+puerto distinto. */
export function groupVps(servers: readonly ServerProfile[], projects: readonly Project[]): Vps[] {
  const byKey = new Map<string, Vps>();
  for (const s of servers) {
    if (!s.host.trim()) continue;
    const key = vpsKey(s.host, s.port);
    let v = byKey.get(key);
    if (!v) {
      v = { key, host: s.host.trim(), port: s.port, name: "", profiles: [], projectIds: [] };
      byKey.set(key, v);
    }
    v.profiles.push(s);
  }
  for (const v of byKey.values()) {
    const ids = new Set(v.profiles.map((p) => p.id));
    v.projectIds = projects.filter((p) => p.serverIds.some((id) => ids.has(id))).map((p) => p.id);
    v.name = commonName(v.profiles.map((p) => p.name)) ?? v.host;
  }
  return [...byKey.values()];
}

/** Compara IPs por sus números (10.0.0.9 antes que 10.0.0.10); los nombres, como texto. */
export function compareHost(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const isIp = (p: number[]) => p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (isIp(pa) && isIp(pb)) {
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  }
  if (isIp(pa) !== isIp(pb)) return isIp(pa) ? -1 : 1;
  return a.localeCompare(b);
}

const byHost = (a: Vps, b: Vps) => compareHost(a.host, b.host) || a.port - b.port;

/**
 * Secciones de la vista. Por proyecto: una por proyecto (un VPS puede salir en varias) y al final
 * «Sin proyecto». Por IP: una sola lista ordenada por dirección. `onlyProject` deja solo ese proyecto.
 */
export function sections(
  vps: readonly Vps[],
  projects: readonly Project[],
  groupBy: FleetGroupBy,
  onlyProject: string | null = null,
): FleetSection[] {
  const list = onlyProject ? vps.filter((v) => v.projectIds.includes(onlyProject)) : [...vps];
  if (groupBy === "ip") {
    return list.length ? [{ id: "all", title: "Por IP", color: null, vps: list.sort(byHost) }] : [];
  }
  const out: FleetSection[] = [];
  for (const p of projects) {
    if (onlyProject && p.id !== onlyProject) continue;
    const mine = list.filter((v) => v.projectIds.includes(p.id)).sort(byHost);
    if (mine.length) out.push({ id: p.id, title: p.name, color: p.color, vps: mine });
  }
  const loose = list.filter((v) => v.projectIds.length === 0).sort(byHost);
  if (loose.length) out.push({ id: "", title: "Sin proyecto", color: null, vps: loose });
  return out;
}

/** VPS distintos de unas secciones (para conectar cada uno una sola vez). */
export function uniqueVps(secs: readonly FleetSection[]): Vps[] {
  const seen = new Map<string, Vps>();
  for (const s of secs) for (const v of s.vps) if (!seen.has(v.key)) seen.set(v.key, v);
  return [...seen.values()];
}

/**
 * VPS que hay que leer con varias pestañas del panel abiertas: los de cualquiera de sus ámbitos
 * (null = todos; un id = los de ese proyecto). Agrupar por proyecto o por IP no cambia cuáles son.
 */
export function fleetTargets(vps: readonly Vps[], scopes: readonly (string | null)[]): Vps[] {
  if (scopes.includes(null)) return [...vps];
  return vps.filter((v) => v.projectIds.some((id) => scopes.includes(id)));
}

export interface PickContext {
  /** Perfiles con una pestaña conectada (su sesión se reutiliza). */
  withTab: ReadonlySet<string>;
  /** Usuarios con sudo o root según la última lectura de ese VPS. */
  sudoUsers: ReadonlySet<string>;
}

/**
 * Perfil con el que se lee el VPS: uno con pestaña abierta (no abre otra conexión); si no, el que
 * tiene sudo (visto antes, root o con sudo configurado); si no, el primero.
 */
export function pickProfile(v: Vps, ctx: PickContext): ServerProfile | null {
  const tests: ((p: ServerProfile) => boolean)[] = [
    (p) => ctx.withTab.has(p.id),
    (p) => ctx.sudoUsers.has(p.username) || p.username === "root",
    (p) => p.sudoMode === "login" || p.sudoMode === "saved",
  ];
  for (const t of tests) {
    const hit = v.profiles.find(t);
    if (hit) return hit;
  }
  return v.profiles[0] ?? null;
}
