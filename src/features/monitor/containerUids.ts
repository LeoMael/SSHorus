// De qué contenedor es cada proceso (funciones puras, sin React ni Tauri).
//
// Podman sin root da a cada usuario un rango de uid propio (/etc/subuid, p. ej. «leo_oti:589824:65536»)
// para los usuarios de dentro de sus contenedores: el uid 1 de dentro es 589824, el 999 es 590822…
// (el 0 de dentro es el propio usuario). Esos uid no están en /etc/passwd y el Monitor los mostraba
// como números sueltos. Aquí se averigua:
// - el dueño y el uid de dentro, con /etc/subuid;
// - el contenedor, con /proc/<pid>/cgroup (libpod-<id>.scope, docker-<id>.scope…);
// - su nombre, con la línea de órdenes de su `conmon` («-c <id> … -n <nombre>»), que se puede leer sin
//   sudo, o con la lista de `podman|docker stats` del usuario conectado.

export interface SubIdRange {
  /** Nombre del usuario (o su uid, si el archivo lo pone así). */
  owner: string;
  start: number;
  count: number;
}

export interface SubUidOwner {
  owner: string;
  /** uid dentro del contenedor (0 = el propio dueño, que no cae en el rango; el primero del rango es 1). */
  innerUid: number;
}

export type ContainerEngine = "podman" | "docker" | "other";

export interface ContainerRef {
  engine: ContainerEngine;
  /** id corto (12 caracteres), como lo muestran `podman ps` y `docker ps`. */
  id: string;
}

/** Contenedor de un proceso, tal y como lo muestra el Monitor. */
export interface ProcContainer {
  /** Dueño del contenedor (de /etc/subuid, o el usuario del proceso). null si no se sabe. */
  owner: string | null;
  /** uid dentro del contenedor, si el del proceso es de un rango de /etc/subuid. */
  innerUid: number | null;
  engine: ContainerEngine | null;
  /** null: aún no se sabe (o no se puede leer su cgroup). */
  id: string | null;
  name: string | null;
}

export const shortId = (id: string): string => id.slice(0, 12);

/** `/etc/subuid`: «usuario:inicio:cantidad» por línea. */
export function parseSubuid(lines: string[]): SubIdRange[] {
  const out: SubIdRange[] = [];
  for (const l of lines) {
    const m = /^([^:#\s]+):(\d+):(\d+)\s*$/.exec(l.trim());
    if (!m) continue;
    const start = Number(m[2]);
    const count = Number(m[3]);
    if (count > 0 && Number.isSafeInteger(start + count)) out.push({ owner: m[1], start, count });
  }
  return out;
}

/** Dueño de un uid subordinado. `nameOf` traduce el dueño si /etc/subuid lo pone con su número. */
export function subuidOwner(uid: number, ranges: SubIdRange[], nameOf: (uid: number) => string | null): SubUidOwner | null {
  const r = ranges.find((x) => uid >= x.start && uid < x.start + x.count);
  if (!r) return null;
  const owner = /^\d+$/.test(r.owner) ? (nameOf(Number(r.owner)) ?? r.owner) : r.owner;
  return { owner, innerUid: uid - r.start + 1 };
}

const CGROUP_IDS: [RegExp, ContainerEngine][] = [
  // Podman con systemd («libpod-<id>.scope») y con cgroupfs («libpod_parent/libpod-<id>»). Su conmon va
  // en «libpod-conmon-<id>.scope», que no es el contenedor (y no encaja: «conmon» no es hexadecimal).
  [/libpod-([0-9a-f]{12,64})\b/, "podman"],
  [/docker-([0-9a-f]{12,64})\.scope/, "docker"],
  [/\/docker\/([0-9a-f]{12,64})\b/, "docker"],
  [/(?:cri-containerd|crio)-([0-9a-f]{12,64})\b/, "other"],
];

/** Contenedor de una ruta de cgroup (una línea de /proc/<pid>/cgroup), o null si no es de uno. */
export function containerFromCgroup(line: string): ContainerRef | null {
  for (const [re, engine] of CGROUP_IDS) {
    const m = re.exec(line);
    if (m) return { engine, id: shortId(m[1]) };
  }
  return null;
}

/** Salida de `grep -H … /proc/<pid>/cgroup`: «/proc/123/cgroup:0::/user.slice/…». */
export function parseCgroupLines(lines: string[]): Map<number, ContainerRef> {
  const out = new Map<number, ContainerRef>();
  for (const l of lines) {
    const m = /^\/proc\/(\d+)\/cgroup:(.*)$/.exec(l.trim());
    if (!m) continue;
    const pid = Number(m[1]);
    if (out.has(pid)) continue;
    const ref = containerFromCgroup(m[2]);
    if (ref) out.set(pid, ref);
  }
  return out;
}

/** Líneas «<pid> <línea de órdenes de conmon>»: id y nombre del contenedor que acompaña. */
export function parseConmonLines(lines: string[]): Map<number, { id: string; name: string | null }> {
  const out = new Map<number, { id: string; name: string | null }>();
  for (const l of lines) {
    // Los argumentos van separados por NUL (o por espacios si `tr` los cambió).
    const f = l.split(/[\s\u0000]+/).filter(Boolean);
    const pid = Number(f[0]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const arg = (...names: string[]) => {
      const i = f.findIndex((x, j) => j > 0 && names.includes(x));
      return i > 0 ? (f[i + 1] ?? null) : null;
    };
    const id = arg("-c", "--cid");
    if (!id || !/^[0-9a-f]{12,64}$/.test(id)) continue;
    const name = arg("-n", "--name");
    out.set(pid, { id: shortId(id), name: name && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) ? name : null });
  }
  return out;
}

/** Más pids que esto: se lee el cgroup de todos (la lista no cabe en el comando). */
export const MAX_CGROUP_PIDS = 64;
/** conmon por muestra, como mucho (el resto, en la siguiente). */
export const MAX_CONMON_PIDS = 24;

const validPids = (pids: number[]) => pids.filter((p) => Number.isInteger(p) && p > 0);

/**
 * Partes del script de muestreo (mismas reglas de comillas que `buildSampleCommand`). Con muchos pids se lee
 * el cgroup de todos. Solo salen las líneas de cgroup de contenedores.
 */
export function attributionParts(cgPids: number[], conmonPids: number[]): string[] {
  const parts: string[] = [];
  const cg = validPids(cgPids);
  if (cg.length) {
    const paths = cg.length > MAX_CGROUP_PIDS ? "/proc/[0-9]*/cgroup" : cg.map((p) => `/proc/${p}/cgroup`).join(" ");
    parts.push(`echo @@cg; grep -H -e libpod- -e docker -e containerd -e crio ${paths} 2>/dev/null`);
  }
  const cm = validPids(conmonPids).slice(0, MAX_CONMON_PIDS);
  if (cm.length) {
    parts.push(`echo @@conmon; for p in ${cm.join(" ")}; do echo "$p $(tr "[:cntrl:]" " " < /proc/$p/cmdline 2>/dev/null)"; done`);
  }
  return parts;
}

/** Clave del selector «Usuario» de Contenedores para ver los de `owner`. */
export function containersOwnerKey(c: Pick<ProcContainer, "owner" | "engine">, me: string | null, meIsRoot: boolean): string {
  if (c.engine === "docker" || !c.owner || c.owner === me) return "self";
  if (c.owner === "root") return meIsRoot ? "self" : "root";
  return `u:${c.owner}`;
}

/** Cómo se llama un contenedor en pantalla: su nombre, o su id corto. */
export const containerLabel = (c: { id: string | null; name: string | null }): string | null => c.name ?? c.id;
