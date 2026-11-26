// Qué bases de datos hay en el servidor, sin recorrer el disco: los puertos en escucha (los mismos que
// Administración → Puertos y Túneles → «Servicios que puedes traer»), los sockets habituales y los
// contenedores con imagen de PostgreSQL o MySQL/MariaDB (los tuyos y, con sudo, los de root y de cada
// usuario). Los archivos SQLite solo se leen si el usuario da la ruta. Funciones puras + `discoverDatabases`.
import type { ListenPort } from "../admin";
import type { FoundContainer } from "../containers";
import { splitSections } from "../../lib/remote";
import { findServices, identifyService } from "../tunnels/detect";
import type { DbEngine, DbTarget } from "./types";

/** Programas cliente y sockets del servidor (como el usuario conectado; no hace falta sudo). */
export const PROBE_SCRIPT = [
  "PATH=$PATH:/usr/local/bin:/usr/bin:/usr/sbin:/sbin",
  "echo @@tools",
  "for t in psql pg_dump mysql mariadb sqlite3; do command -v $t >/dev/null 2>&1 && echo $t; done",
  "echo @@sockets",
  "for s in /var/run/postgresql/.s.PGSQL.* /run/postgresql/.s.PGSQL.* /tmp/.s.PGSQL.* /run/mysqld/mysqld.sock /var/run/mysqld/mysqld.sock /var/lib/mysql/mysql.sock /tmp/mysql.sock; do [ -S \"$s\" ] && echo \"$s\"; done",
  "echo @@end",
].join("\n");

export interface Probe {
  tools: Set<string>;
  /** Puertos de los sockets de PostgreSQL (`.s.PGSQL.5432`). */
  pgSockets: number[];
  mysqlSocket: boolean;
}

export function parseProbe(stdout: string): Probe {
  const s = splitSections(stdout);
  const pg = new Set<number>();
  let mysqlSocket = false;
  for (const line of s.get("sockets") ?? []) {
    const m = /\.s\.PGSQL\.(\d+)$/.exec(line.trim());
    if (m) pg.add(Number(m[1]));
    else if (/mysql/.test(line)) mysqlSocket = true;
  }
  return { tools: new Set((s.get("tools") ?? []).map((t) => t.trim())), pgSockets: [...pg].sort((a, b) => a - b), mysqlSocket };
}

/** Motor de un servicio reconocido (catálogo de Túneles). */
function engineOf(serviceId: string | undefined): Exclude<DbEngine, "sqlite"> | null {
  if (serviceId === "postgres") return "postgres";
  if (serviceId === "mysql") return "mysql";
  return null;
}

export const ENGINE_LABEL: Record<DbEngine, string> = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", sqlite: "SQLite" };
const KEY_PREFIX: Record<DbEngine, string> = { postgres: "pg", mysql: "mysql", sqlite: "sqlite" };

/** Aviso si falta el programa para leerla desde el servidor (en un contenedor se usa el de la imagen). */
function hostProblem(engine: DbEngine, tools: Set<string>): string | null {
  if (engine === "postgres" && !tools.has("psql")) return "Falta psql en el servidor (paquete postgresql-client)";
  if (engine === "mysql" && !tools.has("mysql") && !tools.has("mariadb")) return "Falta el cliente mysql o mariadb en el servidor";
  if (engine === "sqlite" && !tools.has("sqlite3")) return "Falta sqlite3 en el servidor";
  return null;
}

export function hostTarget(engine: Exclude<DbEngine, "sqlite">, host: string, port: number, detail: string, tools: Set<string>): DbTarget {
  return {
    key: `${KEY_PREFIX[engine]}@${host}:${port}`,
    engine,
    place: { kind: "host", host, port },
    label: `${ENGINE_LABEL[engine]} :${port}`,
    detail,
    problem: hostProblem(engine, tools),
  };
}

export function sqliteTarget(path: string, tools: Set<string> | null): DbTarget {
  return {
    key: `sqlite@${path}`,
    engine: "sqlite",
    place: { kind: "file", path },
    label: path.split("/").pop() || path,
    detail: path,
    problem: tools ? hostProblem("sqlite", tools) : null,
  };
}

function containerEngine(c: FoundContainer): Exclude<DbEngine, "sqlite"> | null {
  const inner = c.ports.map((p) => p.containerPort);
  return engineOf(identifyService([c.image, c.name].map((n) => n.toLowerCase()), inner)?.id);
}

/**
 * Destinos encontrados: servicios del servidor (puerto en escucha o socket) y contenedores en marcha con
 * PostgreSQL o MySQL/MariaDB. Un puerto que publica uno de esos contenedores no se repite como servicio
 * (se entra por el contenedor, que no necesita contraseña).
 */
export function buildTargets(o: { ports: ListenPort[]; containers: FoundContainer[]; probe: Probe; sshPort?: number }): DbTarget[] {
  const out: DbTarget[] = [];
  const ctrs = o.containers
    .filter((c) => c.state === "running")
    .map((c) => ({ c, engine: containerEngine(c) }))
    .filter((x): x is { c: FoundContainer; engine: Exclude<DbEngine, "sqlite"> } => x.engine !== null);
  const published = new Set(ctrs.flatMap(({ c }) => c.ports.map((p) => p.hostPort).filter((p): p is number => p !== null)));
  const seen = new Set<string>();
  for (const s of findServices(o.ports, [], o.sshPort ?? 22)) {
    const engine = engineOf(s.service?.id);
    if (!engine || s.container || published.has(s.port)) continue;
    const t = hostTarget(engine, s.destHost, s.port, s.procs.length ? s.procs.join(", ") : "puerto habitual", o.probe.tools);
    if (!seen.has(`${engine}:${s.port}`)) out.push(t);
    seen.add(`${engine}:${s.port}`);
  }
  // Solo por socket (sin puerto TCP a la vista).
  for (const port of o.probe.pgSockets) {
    if (!seen.has(`postgres:${port}`)) out.push(hostTarget("postgres", "127.0.0.1", port, "socket local", o.probe.tools));
  }
  if (o.probe.mysqlSocket && !out.some((t) => t.engine === "mysql") && !published.has(3306)) {
    out.push(hostTarget("mysql", "127.0.0.1", 3306, "socket local", o.probe.tools));
  }
  for (const { c, engine } of ctrs) {
    out.push({
      // Con el motor: un «db» de Docker y otro de Podman del mismo usuario son bases distintas.
      key: `${KEY_PREFIX[engine]}@ctr:${c.engine}:${c.user}/${c.name}`,
      engine,
      place: { kind: "container", engine: c.engine, owner: c.ctOwner, user: c.user, sudo: c.sudo, id: c.id, name: c.name, image: c.image },
      label: c.name,
      detail: `${ENGINE_LABEL[engine]} · ${c.image}${c.user ? ` · ${c.user}` : ""}`,
      problem: null,
    });
  }
  return out;
}
