// Pruebas de «Bases de datos»: scripts (la contraseña nunca en la línea de comandos), orden de las formas
// de entrar, qué se encuentra en el servidor y el diagrama. Los scripts se ejecutan de verdad con `sh` y
// clientes falsos (psql, mysql, podman) que enseñan sus argumentos, su entorno y lo que leen por stdin.
import type { ListenPort } from "../admin/ports";
import type { FoundContainer } from "../containers/readAll";
import { buildExec } from "../privileges/elevate";
import { authPlan, needsElevation } from "./auth";
import { buildTargets, parseProbe } from "./discover";
import { layoutDiagram, MAX_ROWS } from "./diagram";
import { clientScript, type ClientCall } from "./scripts";
import type { DbPlace, DbTable, DbTarget } from "./types";
import { filterTables, groupTargets, withNeighbors } from "./view";

// Sin @types/node en el proyecto: se carga a mano lo justo para ejecutar `sh`.
const CHILD = "node:child_process";
const FS = "node:fs";
const OS = "node:os";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], o: { input: string; encoding: "utf8"; env: Record<string, string> }) => { status: number | null; stdout: string; stderr: string };
};
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = (await import(/* @vite-ignore */ FS)) as {
  chmodSync: (p: string, mode: number) => void;
  mkdtempSync: (prefix: string) => string;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
  writeFileSync: (p: string, data: string) => void;
};
const { tmpdir } = (await import(/* @vite-ignore */ OS)) as { tmpdir: () => string };
const join = (...parts: string[]) => parts.join("/");

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(v: boolean, what: string) {
  eq(v, true, what);
}

// ── Ejecución con clientes falsos ──
const dir = mkdtempSync(join(tmpdir(), "sshorus-db-"));
const FAKE = `#!/bin/sh
echo "PROG=$(basename "$0")"
for a in "$@"; do echo "ARG=$a"; done
echo "PGPASSWORD=\${PGPASSWORD-<sin>}"
echo "MYSQL_PWD=\${MYSQL_PWD-<sin>}"
case "$*" in *"SELECT VERSION()"*) echo 11.4-MariaDB; exit 0 ;; esac
echo "STDIN<<"; cat; echo ">>"
`;
// podman falso: enseña sus argumentos y ejecuta lo que va tras «sh -c» como si fuera dentro del contenedor.
const PODMAN = `#!/bin/sh
echo "PROG=podman"
for a in "$@"; do echo "ARG=$a"; done
C=''; prev=''
for a in "$@"; do [ "$prev" = "-c" ] && C=$a; prev=$a; done
exec sh -c "$C"
`;
for (const [name, body] of [["psql", FAKE], ["pg_dump", FAKE], ["mysql", FAKE], ["mariadb", FAKE], ["sqlite3", FAKE], ["podman", PODMAN]] as const) {
  writeFileSync(join(dir, name), body);
  chmodSync(join(dir, name), 0o755);
}

function run(c: ClientCall) {
  const { script, secret } = clientScript(c);
  const req = buildExec(script, { kind: "none" }, secret);
  const r = spawnSync("sh", ["-c", req.command], { input: req.stdin, encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
  return { script, secret, out: r.stdout, err: r.stderr, code: r.status };
}

const HOST: DbPlace = { kind: "host", host: "127.0.0.1", port: 5433 };
const SECRET = "s3cr'et $x `y`";
try {
  const pw = run({ engine: "postgres", place: HOST, auth: { kind: "password", user: "app", password: SECRET }, database: "tienda", action: { kind: "sql", sql: "SELECT 'V', 1;" } });
  eq(pw.code, 0, "psql falso: sale bien");
  ok(!pw.script.includes("s3cr"), "la contraseña no está en el script");
  eq(pw.secret, `${SECRET}\n`, "va por stdin");
  ok(pw.out.includes(`PGPASSWORD=${SECRET}\n`), "llega a psql por PGPASSWORD, tal cual");
  ok(!pw.out.split("\n").some((l) => l.startsWith("ARG=") && l.includes("s3cr")), "y nunca por sus argumentos");
  ok(pw.out.includes("ARG=-h\nARG=127.0.0.1\nARG=-p\nARG=5433\nARG=-U\nARG=app\nARG=-d\nARG=dbname='tienda'"), "conexión por TCP con usuario y base");
  ok(pw.out.includes("STDIN<<\nSELECT 'V', 1;\n>>"), "el SQL llega por stdin, sin tocar");
  ok(pw.script.includes("-c standard_conforming_strings=on'"), "psql: «\\» nunca escapa la comilla de un literal (aunque la base lo tenga apagado)");

  const peer = run({ engine: "postgres", place: HOST, auth: { kind: "peer" }, database: null, action: { kind: "sql", sql: "SELECT 1;" } });
  ok(peer.out.includes("PGPASSWORD=<sin>") && peer.out.includes("ARG=dbname='postgres'") && !peer.out.includes("ARG=-h"), "peer: por socket, sin contraseña, base postgres");

  const dump = run({ engine: "postgres", place: HOST, auth: { kind: "peer" }, database: "app", action: { kind: "pgdump", pattern: '"public"."t"' } });
  ok(dump.out.includes("PROG=pg_dump") && dump.out.includes('ARG="public"."t"') && dump.out.includes("ARG=--schema-only"), "pg_dump --schema-only -t con el patrón exacto");

  const my = run({ engine: "mysql", place: { kind: "host", host: "127.0.0.1", port: 3306 }, auth: { kind: "password", user: "root", password: SECRET }, database: "x", action: { kind: "sql", sql: "SELECT 2;" } });
  ok(my.out.includes(`MYSQL_PWD=${SECRET}\n`) && !my.script.includes("s3cr"), "mysql: contraseña por MYSQL_PWD");
  ok(my.out.includes("STDIN<<\nSET SESSION max_statement_time=30;\nSTART TRANSACTION READ ONLY;\nSELECT 2;\n>>"), "mysql: límite de tiempo (MariaDB) y transacción de solo lectura antes del SQL");

  const ctrPlace: DbPlace = { kind: "container", engine: "podman", owner: { kind: "self" }, user: "ana", sudo: false, id: "a".repeat(64), name: "db", image: "postgres:17" };
  const ctr = run({ engine: "postgres", place: ctrPlace, auth: { kind: "password", user: "app", password: SECRET }, database: null, action: { kind: "sql", sql: "SELECT 3;" } });
  ok(ctr.out.includes(`ARG=exec\nARG=-i\nARG=-e\nARG=PGPASSWORD\nARG=${"a".repeat(64)}\nARG=sh\nARG=-c`), "contenedor: exec -e PGPASSWORD (sin valor en la línea de comandos)");
  ok(!ctr.out.split("\n").some((l) => l.startsWith("ARG=") && l.includes("s3cr")), "contenedor: la contraseña no va en los argumentos");
  const local = clientScript({ engine: "postgres", place: ctrPlace, auth: { kind: "local" }, database: null, action: { kind: "sql", sql: "SELECT 4;" } });
  ok(local.secret === "" && local.script.includes("${POSTGRES_USER:-postgres}") && !local.script.includes("-e PGPASSWORD"), "contenedor sin contraseña: usuario y clave de la imagen, dentro");

  const lite = run({ engine: "sqlite", place: { kind: "file", path: join(dir, "psql") }, auth: { kind: "peer" }, database: null, action: { kind: "sql", sql: "SELECT 5;" } });
  ok(lite.out.includes("ARG=-readonly") && lite.out.includes("ARG=-ascii"), "sqlite3 de solo lectura con separadores ASCII");
  const missing = run({ engine: "sqlite", place: { kind: "file", path: join(dir, "nada.db") }, auth: { kind: "peer" }, database: null, action: { kind: "sql", sql: "SELECT 6;" } });
  eq([missing.code, missing.err.trim()], [2, "sshorus: no existe el archivo"], "sqlite: archivo que no existe");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const bad = (c: Partial<ClientCall>) => () => clientScript({ engine: "postgres", place: HOST, auth: { kind: "peer" }, database: null, action: { kind: "sql", sql: "" }, ...c });
for (const [what, f] of [
  ["base con salto de línea", bad({ database: "a\nb" })],
  ["contraseña con salto de línea", bad({ auth: { kind: "password", user: "u", password: "a\nb" } })],
  ["contenedor raro", bad({ place: { kind: "container", engine: "podman", owner: { kind: "self" }, user: "", sudo: false, id: "x; rm", name: "", image: "" } })],
  ["SQLite sin ruta completa", bad({ engine: "sqlite", place: { kind: "file", path: "datos.db" } })],
] as const) {
  let threw = false;
  try {
    f();
  } catch {
    threw = true;
  }
  ok(threw, what);
}

// ── Formas de entrar ──
const target = (place: DbPlace, engine: DbTarget["engine"] = "postgres"): DbTarget => ({ key: "k", engine, place, label: "", detail: "", problem: null });
const kinds = (t: DbTarget, o: Parameters<typeof authPlan>[1]) => authPlan(t, o).map((a) => a.kind);
const saved = { user: "app", password: "x" };
eq(kinds(target(HOST), { saved: null, canElevate: true }), ["service", "peer"], "servicio con sudo: como postgres primero");
eq(kinds(target(HOST), { saved: null, canElevate: false }), ["peer"], "sin sudo: como tu usuario");
eq(kinds(target(HOST), { saved, canElevate: true }), ["password", "service", "peer"], "la guardada primero");
const ctrT = target({ kind: "container", engine: "docker", owner: { kind: "root" }, user: "root", sudo: true, id: "b".repeat(12), name: "db", image: "mysql:8" }, "mysql");
eq(kinds(ctrT, { saved: null, canElevate: false }), ["local"], "contenedor: dentro, sin contraseña");
eq(needsElevation(ctrT, { kind: "local" }), true, "contenedor de root: con sudo");
eq(kinds(target({ kind: "file", path: "/a.db" }, "sqlite"), { saved, canElevate: true }), ["peer", "service"], "SQLite: sin contraseña (no usa la guardada)");

// ── Qué se encuentra ──
const port = (p: number, procs: string[] = [], container: string | null = null): ListenPort => ({
  key: `tcp|127.0.0.1||${p}`,
  proto: "tcp",
  ip: "127.0.0.1",
  iface: null,
  port: p,
  family: 4,
  scope: "local",
  procs: procs.map((name, i) => ({ name, pid: 100 + i })),
  user: null,
  unit: null,
  container,
});
const ctrOf = (name: string, image: string, hostPort: number | null, state = "running"): FoundContainer =>
  ({
    id: "c".repeat(64),
    shortId: "c".repeat(12),
    name,
    image,
    state,
    ports: hostPort === null ? [] : [{ hostIp: "127.0.0.1", hostPort, containerPort: 5432, protocol: "tcp", range: 1 }],
    engine: "podman",
    user: "ana",
    ctOwner: { kind: "self" },
    sudo: false,
  }) as unknown as FoundContainer;
const probe = parseProbe("@@tools\npsql\nmariadb\n@@sockets\n/var/run/postgresql/.s.PGSQL.5432\n/run/mysqld/mysqld.sock\n@@end\n");
eq([...probe.tools], ["psql", "mariadb"], "programas cliente");
eq([probe.pgSockets, probe.mysqlSocket], [[5432], true], "sockets");
const targets = buildTargets({
  ports: [port(5432, ["postgres"]), port(5433, ["rootlessport"]), port(8080, ["node"]), port(22, ["sshd"])],
  containers: [ctrOf("tienda-db", "docker.io/library/postgres:17", 5433), ctrOf("vieja", "postgres:12", null, "exited"), ctrOf("web", "nginx", null)],
  probe,
});
eq(targets.map((t) => t.key), ["pg@127.0.0.1:5432", "mysql@127.0.0.1:3306", "pg@ctr:podman:ana/tienda-db"], "servicio, socket de mysql y contenedor; sin repetir el puerto que publica el contenedor ni los parados");
eq(targets.map((t) => t.problem), [null, null, null], "con psql y mariadb no hay avisos");
eq(buildTargets({ ports: [port(3306, ["mysqld"])], containers: [], probe: parseProbe("") })[0].problem, "Falta el cliente mysql o mariadb en el servidor", "aviso si falta el cliente");
eq(groupTargets(targets).map((g) => [g.title, g.targets.length]), [["En el servidor", 2], ["En contenedores", 1]], "grupos de la lista");

// ── Diagrama y búsqueda ──
const tbl = (name: string, cols: number, fks: [string, string][] = []): DbTable => ({
  schema: "public",
  name,
  kind: "table",
  rows: null,
  bytes: null,
  comment: "",
  columns: Array.from({ length: cols }, (_, i) => ({ name: i === 0 ? "id" : `${name}_c${i}`, type: "int", nullable: true, default: null, pk: i === 0 })),
  indexes: [],
  foreignKeys: fks.map(([col, to]) => ({ name: `${name}_${col}`, columns: [col], refSchema: "public", refTable: to, refColumns: ["id"] })),
});
const tables = [tbl("clientes", 3), tbl("pedidos", 4, [["pedidos_c1", "clientes"]]), tbl("lineas", 14, [["lineas_c1", "pedidos"], ["lineas_c2", "fuera"]]), tbl("nodos", 2, [["nodos_c1", "nodos"]]), tbl("suelta", 1)];
const d = layoutDiagram(tables);
eq(d.boxes.length, 5, "una caja por tabla");
eq(d.edges.map((e) => `${e.from}>${e.to}`).sort(), ["public.lineas>public.pedidos", "public.nodos>public.nodos", "public.pedidos>public.clientes"], "flechas solo hacia tablas dibujadas (también a sí misma)");
const big = d.boxes.find((b) => b.table.name === "lineas");
eq([big?.cols.length, big?.hidden], [MAX_ROWS, 4], "caja con «+N más»");
const overlap = d.boxes.some((a, i) => d.boxes.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
eq(overlap, false, "las cajas no se pisan");
ok(d.boxes.every((b) => b.x + b.w <= d.width && b.y + b.h <= d.height), "todo cabe en el lienzo");
eq(filterTables([...tables, tbl("c1_log", 1)], "C1").map((t) => t.name), ["c1_log", "clientes", "pedidos", "lineas", "nodos"], "búsqueda: por nombre primero, luego por columna");
eq(withNeighbors(tables, [tables[1]]).map((t) => t.name), ["clientes", "pedidos", "lineas"], "diagrama de la búsqueda: con sus vecinas");

console.log(`${passed} comprobaciones`);
