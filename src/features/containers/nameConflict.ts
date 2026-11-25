// «Ya existe un contenedor con ese nombre» al levantar un proyecto Compose: qué contenedor estorba, qué
// otros del mismo origen chocarán después y qué datos se pueden perder al reemplazarlo. Funciones puras.
//
// Pasa sobre todo al cambiar de herramienta (p. ej. de podman-compose a docker-compose): el contenedor
// viejo tiene el nombre fijo de `container_name`, pero la herramienta nueva no lo reconoce como suyo.
import type { Container, InspectSummary } from "./types";

export interface NameConflict {
  name: string;
  /** Id del contenedor que ya tiene ese nombre (si el mensaje lo dice). */
  id: string | null;
}

const CONFLICT_RES = [
  // Podman: the container name "x" is already in use by 9f39…  ·  Docker: … by container "9f39…"
  /container name "\/?([^"]+)" is already in use by (?:container )?"?([0-9a-f]{12,64})?/gi,
  // Podman (create --name): name "x" is in use: container already exists
  /\bname "\/?([^"]+)" is in use\b/gi,
];

/** Nombres que chocan según la salida del motor o de Compose (sin repetir). */
export function parseNameConflicts(text: string): NameConflict[] {
  const out = new Map<string, NameConflict>();
  for (const re of CONFLICT_RES) {
    for (const m of text.matchAll(re)) {
      const prev = out.get(m[1]);
      out.set(m[1], { name: m[1], id: m[2] ?? prev?.id ?? null });
    }
  }
  return [...out.values()];
}

/** Nombres fijos (`container_name`) de la salida de `compose config`. */
export function parseContainerNames(config: string): string[] {
  const names = new Set<string>();
  for (const m of config.matchAll(/^\s+container_name:\s*["']?([A-Za-z0-9][A-Za-z0-9_.-]*)["']?\s*$/gm)) names.add(m[1]);
  return [...names];
}

/** Quién creó el contenedor (para la explicación y para buscar sus «hermanos»). */
export function composeOrigin(labels: Record<string, string>): { tool: string; project: string } | null {
  const pc = labels["io.podman.compose.project"];
  if (pc) return { tool: "podman-compose", project: pc };
  const dc = labels["com.docker.compose.project"];
  if (dc) return { tool: "docker compose", project: dc };
  return null;
}

function originKey(c: Container): string {
  const o = composeOrigin(c.labels);
  return o ? `${o.tool}|${o.project}` : "a mano";
}

/**
 * Contenedores que hay que quitar: los que chocan (por id o nombre, del mismo dueño) y los que chocarán
 * después: con un nombre fijo del archivo compose y del mismo origen que alguno de los que chocan.
 */
export function conflictTargets(conflicts: NameConflict[], containers: Container[], owner: string, expected: string[]): { now: Container[]; later: Container[] } {
  const mine = containers.filter((c) => (c.owner ?? owner) === owner);
  const now = mine.filter((c) => conflicts.some((k) => c.name === k.name || (!!k.id && (c.id.startsWith(k.id) || k.id.startsWith(c.id)))));
  const origins = new Set(now.map(originKey));
  const later = mine.filter((c) => !now.includes(c) && expected.includes(c.name) && origins.has(originKey(c)));
  return { now, later };
}

// ───────── Datos que se pueden perder ─────────

export type Mount = InspectSummary["mounts"][number];

/** Carpetas donde guardan sus datos las imágenes más comunes (por el nombre de la imagen). */
const DATA_DIRS: [RegExp, string[]][] = [
  [/^(postgres|postgis|timescaledb|pgvector)/, ["/var/lib/postgresql/data"]],
  [/^(mysql|mariadb|percona)/, ["/var/lib/mysql"]],
  [/^mongo/, ["/data/db"]],
  [/^(redis|valkey|keydb)/, ["/data"]],
  [/^elasticsearch/, ["/usr/share/elasticsearch/data"]],
  [/^opensearch/, ["/usr/share/opensearch/data"]],
  [/^influxdb/, ["/var/lib/influxdb2", "/var/lib/influxdb"]],
  [/^rabbitmq/, ["/var/lib/rabbitmq"]],
  [/^couchdb/, ["/opt/couchdb/data"]],
  [/^clickhouse/, ["/var/lib/clickhouse"]],
  [/^(mssql|mssql-server)/, ["/var/opt/mssql"]],
  [/^(minio|neo4j|gitea)/, ["/data"]],
];

/** Más de esto escrito dentro del contenedor (fuera de los volúmenes) cuenta como datos que se perderían. */
export const RW_RISK_BYTES = 1024 * 1024;

/** Nombre corto de la imagen: «docker.io/library/postgres:18» → «postgres». */
export function imageBase(image: string): string {
  const last = image.toLowerCase().split("@")[0].split("/").pop() ?? "";
  return last.split(":")[0];
}

/** Carpetas de datos conocidas de ese contenedor (PGDATA manda si está). */
export function dataDirs(s: Pick<InspectSummary, "image" | "env">): string[] {
  const base = imageBase(s.image);
  const dirs = DATA_DIRS.find(([re]) => re.test(base))?.[1] ?? [];
  const pg = s.env.find((e) => e.key === "PGDATA")?.value;
  return pg ? [pg] : dirs;
}

export function isAnonymousVolume(m: Mount): boolean {
  return m.type === "volume" && (!m.name || /^[0-9a-f]{64}$/.test(m.name));
}

/** El montaje más concreto que contiene esa carpeta (o null). */
function coveringMount(dir: string, mounts: Mount[]): Mount | null {
  let best: Mount | null = null;
  for (const m of mounts) {
    const d = m.destination.replace(/\/+$/, "");
    if ((dir === d || dir.startsWith(`${d}/`)) && (!best || d.length > best.destination.replace(/\/+$/, "").length)) best = m;
  }
  return best;
}

export interface ReplaceAssessment {
  /** Volúmenes con nombre: se conservan y el contenedor nuevo los vuelve a usar. */
  named: Mount[];
  /** Carpetas del servidor: se conservan. */
  binds: Mount[];
  /** Volúmenes anónimos: no se borran, pero el contenedor nuevo no los usa (empieza vacío). */
  anonymous: Mount[];
  /** Carpetas de datos (de la imagen) que no están en un volumen con nombre ni en una carpeta del servidor. */
  unsafeDataDirs: string[];
  /** Bytes escritos dentro del contenedor, fuera de los volúmenes (null = no se sabe). */
  sizeRw: number | null;
  /** Hay riesgo de perder datos: hay que marcar la casilla antes de reemplazar. */
  risky: boolean;
}

export function assessReplace(s: Pick<InspectSummary, "image" | "env" | "mounts"> & { sizeRw: number | null }): ReplaceAssessment {
  const named = s.mounts.filter((m) => m.type === "volume" && !isAnonymousVolume(m));
  const binds = s.mounts.filter((m) => m.type === "bind");
  const anonymous = s.mounts.filter(isAnonymousVolume);
  const unsafeDataDirs = dataDirs(s).filter((d) => {
    const m = coveringMount(d, s.mounts);
    return !m || (m.type !== "bind" && !(m.type === "volume" && !isAnonymousVolume(m)));
  });
  const risky = anonymous.length > 0 || unsafeDataDirs.length > 0 || (s.sizeRw ?? 0) >= RW_RISK_BYTES;
  return { named, binds, anonymous, unsafeDataDirs, sizeRw: s.sizeRw, risky };
}
