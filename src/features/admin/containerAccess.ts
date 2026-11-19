// ¿Quién puede usar contenedores? Podman sin root (rangos de /etc/subuid y /etc/subgid, linger) y
// Docker (grupo «docker», que equivale a root, o Docker sin root con su socket en /run/user/<uid>).
// Funciones puras: sin React ni Tauri.
import { splitSections } from "./parse";

/**
 * Lectura (con sudo si se puede; si no, como usuario normal). /etc/subuid, /etc/subgid y la carpeta de
 * linger son públicos; los sockets de Docker sin root de otros usuarios solo se ven como root.
 */
export const CONTAINER_ACCESS_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin",
  "echo @@uid; id -u",
  "echo @@tools",
  "command -v podman >/dev/null 2>&1 && echo podman",
  "command -v dockerd >/dev/null 2>&1 && echo dockerd",
  "getent group docker >/dev/null 2>&1 && echo docker-group",
  // usermod de shadow-utils ≥ 4.2 sabe añadir y quitar rangos.
  "usermod --help 2>&1 | grep -q -- --add-subuids && echo subid-usermod",
  "[ -d /run/systemd/system ] && echo systemd",
  "echo @@subuid; cat /etc/subuid 2>/dev/null",
  "echo @@subgid; cat /etc/subgid 2>/dev/null",
  // Linger = un archivo por usuario en esta carpeta (lo mismo que «loginctl show-user -p Linger»).
  "echo @@linger; ls -1A /var/lib/systemd/linger 2>/dev/null",
  "echo @@dockersock; for d in /run/user/*; do [ -S \"$d/docker.sock\" ] && echo \"${d##*/}\"; done 2>/dev/null",
  "echo @@end",
].join("\n");

/** Una línea de /etc/subuid o /etc/subgid: dueño (nombre o UID), primer identificador y cuántos. */
export interface SubidRange {
  owner: string;
  start: number;
  count: number;
}

export interface ContainerAccessInfo {
  podman: boolean;
  /** Docker instalado (dockerd) o al menos existe el grupo «docker». */
  docker: boolean;
  dockerGroup: boolean;
  /** usermod admite --add-subuids/--del-subuids. */
  subidUsermod: boolean;
  subuid: SubidRange[];
  subgid: SubidRange[];
  /** Usuarios con linger; null = sin systemd. */
  linger: Set<string> | null;
  /** UID con Docker sin root encendido; null = no se pudo mirar (sin root solo se ve el propio). */
  dockerSockets: Set<number> | null;
}

export function parseSubids(lines: readonly string[]): SubidRange[] {
  const out: SubidRange[] = [];
  for (const l of lines) {
    const m = /^\s*([^:#\s][^:]*):(\d+):(\d+)\s*$/.exec(l);
    if (m && Number(m[3]) > 0) out.push({ owner: m[1], start: Number(m[2]), count: Number(m[3]) });
  }
  return out;
}

export function parseContainerAccess(stdout: string): ContainerAccessInfo {
  const s = splitSections(stdout);
  if (!s.has("end")) throw new Error("No se pudo leer quién puede usar contenedores");
  const tools = new Set(s.get("tools") ?? []);
  const asRoot = (s.get("uid") ?? [])[0] === "0";
  const sockets = (s.get("dockersock") ?? []).filter((l) => /^\d+$/.test(l)).map(Number);
  return {
    podman: tools.has("podman"),
    docker: tools.has("dockerd") || tools.has("docker-group"),
    dockerGroup: tools.has("docker-group"),
    subidUsermod: tools.has("subid-usermod"),
    subuid: parseSubids(s.get("subuid") ?? []),
    subgid: parseSubids(s.get("subgid") ?? []),
    linger: tools.has("systemd") ? new Set(s.get("linger") ?? []) : null,
    dockerSockets: asRoot ? new Set(sockets) : null,
  };
}

// ───────── Por usuario ─────────

export interface ContainerUser {
  name: string;
  uid: number;
  groups: readonly string[];
  isSystem: boolean;
}

export interface UserContainers {
  /** null = no se muestra (podman no instalado, root o cuenta del sistema sin rangos). */
  podman: "yes" | "limited" | null;
  subuid: SubidRange[];
  subgid: SubidRange[];
  /** null = sin systemd. */
  linger: boolean | null;
  dockerGroup: boolean;
  /** true/false; null = no se pudo mirar (hace falta sudo). */
  dockerRootless: boolean | null;
}

const ownedBy = (u: ContainerUser) => (r: SubidRange) => r.owner === u.name || r.owner === String(u.uid);

export function userContainers(info: ContainerAccessInfo, u: ContainerUser): UserContainers {
  const subuid = info.subuid.filter(ownedBy(u));
  const subgid = info.subgid.filter(ownedBy(u));
  const ranges = subuid.length > 0 && subgid.length > 0;
  const showPodman = info.podman && u.uid !== 0 && (ranges || !u.isSystem);
  return {
    podman: showPodman ? (ranges ? "yes" : "limited") : null,
    subuid,
    subgid,
    linger: info.linger ? info.linger.has(u.name) : null,
    dockerGroup: u.uid !== 0 && u.groups.includes("docker"),
    dockerRootless: info.dockerSockets ? info.dockerSockets.has(u.uid) : null,
  };
}

/** «100000-165535» (primero-último), como lo piden usermod --add-subuids/--del-subuids. */
export function rangeText(r: Pick<SubidRange, "start" | "count">): string {
  return `${r.start}-${r.start + r.count - 1}`;
}

// ───────── Rango libre ─────────

/** Por defecto en login.defs (SUB_UID_MIN, SUB_UID_MAX, SUB_UID_COUNT). */
export const SUBID_MIN = 100000;
export const SUBID_MAX = 600100000;
export const SUBID_COUNT = 65536;

/**
 * Primer rango de `size` identificadores desde `min` que no se solapa con ninguno de /etc/subuid ni de
 * /etc/subgid (el mismo para los dos, así es fácil de leer). null si no cabe antes de `max`.
 */
export function freeSubidRange(
  subuid: readonly SubidRange[],
  subgid: readonly SubidRange[],
  size = SUBID_COUNT,
  min = SUBID_MIN,
  max = SUBID_MAX,
): { start: number; count: number } | null {
  const used = [...subuid, ...subgid].sort((a, b) => a.start - b.start);
  let start = min;
  for (const r of used) {
    if (r.start + r.count <= start) continue;
    if (start + size <= r.start) break;
    start = r.start + r.count;
  }
  return start + size - 1 <= max ? { start, count: size } : null;
}
