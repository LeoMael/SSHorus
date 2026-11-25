// Lectura de las bases de datos en el servidor: buscar destinos, entrar (probando las formas de entrar en
// orden) y leer la lista de bases, el esquema o el DDL. Lo usan la pestaña «Bases de datos» y el MCP.
import type { ExecResult } from "../../api/types";
import { PORTS_SCRIPT, parsePorts } from "../admin/ports";
import { ownerWrap } from "../containers/ownerRun";
import { readElevated, runScript, type Elevation } from "../privileges";
import { authPlan, needsElevation } from "./auth";
import { buildTargets, parseProbe, PROBE_SCRIPT } from "./discover";
import { classifyError, errorText, parseDatabases, parseDdl, parseSchema, type DbErrorKind } from "./parse";
import { databasesSql, ddlSql, pgDumpPattern, schemaSql, type SchemaFilter } from "./queries";
import { clientScript, CLIENT_SECS, type ClientAction } from "./scripts";
import type { DbAuth, DbList, DbSchema, DbTarget } from "./types";
import type { DbCredential } from "../../api/db";

const NONE: Elevation = { kind: "none" };

export interface Discovery {
  targets: DbTarget[];
  /** Se leyó con sudo (se ven los programas de cada puerto y los contenedores de otros usuarios). */
  elevated: boolean;
  /** Programas cliente del servidor (para avisar en los SQLite que se añadan). */
  tools: string[];
  notes: string[];
}

export interface DiscoverOptions {
  /** Elevación para ver más (null = solo como el usuario conectado). */
  elevation: Elevation | null;
  me: string | null;
  isRoot: boolean;
  sshPort: number;
}

export async function discoverDatabases(sessionId: string, o: DiscoverOptions): Promise<Discovery> {
  const [ports, probe] = await Promise.all([
    readElevated(sessionId, PORTS_SCRIPT, o.elevation, 25),
    runScript(sessionId, PROBE_SCRIPT, NONE, "", 15)
      .then((r) => parseProbe(r.stdout))
      .catch(() => parseProbe("")),
  ]);
  const elevated = ports.elevated || o.isRoot;
  const notes: string[] = [];
  const usedEl = ports.elevated ? o.elevation : o.isRoot ? NONE : null;
  const { readAllContainers } = await import("../containers/readAll");
  const containers = await readAllContainers(sessionId, usedEl, o.me, o.isRoot, notes).catch(() => []);
  const targets = buildTargets({ ports: parsePorts(ports.result.stdout).ports, containers, probe, sshPort: o.sshPort });
  return { targets, elevated, tools: [...probe.tools], notes };
}

/** No se pudo entrar: falta usuario y contraseña (o no sirvieron). */
export class DbAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbAuthError";
  }
}

/** Error de lectura con su tipo. */
export class DbReadError extends Error {
  kind: DbErrorKind;
  constructor(kind: DbErrorKind, message: string) {
    super(message);
    this.name = "DbReadError";
    this.kind = kind;
  }
}

export interface DbContext {
  sessionId: string;
  /** Elevación disponible (null = sin sudo). */
  elevation: Elevation | null;
}

interface RunOpts {
  execId?: string;
}

/** Ejecuta el cliente en su sitio (como el dueño del contenedor si es de otro usuario). */
async function runClient(ctx: DbContext, t: DbTarget, auth: DbAuth, database: string | null, action: ClientAction, o: RunOpts = {}): Promise<ExecResult> {
  const el = needsElevation(t, auth) ? ctx.elevation : NONE;
  if (!el) throw new DbReadError("permission", "Hace falta sudo para entrar en esta base de datos");
  const { script, secret } = clientScript({ engine: t.engine, place: t.place, auth, database, action });
  const inner = t.place.kind === "container" ? await ownerWrap(t.place.engine, t.place.owner, script) : script;
  return runScript(ctx.sessionId, inner, el, secret, CLIENT_SECS + 10, o.execId);
}

function check(r: ExecResult): ExecResult {
  if (r.timedOut) throw new DbReadError("other", "La base de datos tardó demasiado en responder y se canceló");
  if (r.exitCode !== 0) {
    const kind = classifyError(r.exitCode, r.stderr);
    throw new DbReadError(kind, errorText(kind, r.stderr || r.stdout.slice(-500)));
  }
  return r;
}

export interface Opened {
  auth: DbAuth;
  /** PostgreSQL y MySQL: sus bases. */
  list: DbList | null;
  /** SQLite: su esquema (tiene una sola base). */
  schema: DbSchema | null;
}

/** Errores tras los que se prueba la siguiente forma de entrar (p. ej. sin socket local, por TCP con contraseña). */
const RETRY: ReadonlySet<DbErrorKind> = new Set(["auth", "permission", "unreachable"]);

/** Primera lectura con cada forma de entrar del plan, hasta que una sirva. */
export async function openTarget(ctx: DbContext, t: DbTarget, saved: DbCredential | null, o: RunOpts = {}): Promise<Opened> {
  const plan = authPlan(t, { saved, canElevate: !!ctx.elevation && ctx.elevation.kind !== "none" });
  let last: DbReadError | null = null;
  for (const auth of plan) {
    try {
      return await openWith(ctx, t, auth, o);
    } catch (e) {
      if (!(e instanceof DbReadError) || !RETRY.has(e.kind)) throw e;
      last = e;
    }
  }
  throw new DbAuthError(last?.message ?? "Hace falta el usuario y la contraseña de la base de datos");
}

/** Primera lectura con una forma de entrar concreta (p. ej. la que escribe el usuario). */
export async function openWith(ctx: DbContext, t: DbTarget, auth: DbAuth, o: RunOpts = {}): Promise<Opened> {
  if (t.engine === "sqlite") return { auth, list: null, schema: await readSchema(ctx, t, auth, "main", {}, o) };
  const r = check(await runClient(ctx, t, auth, null, { kind: "sql", sql: databasesSql(t.engine) }, o));
  return { auth, list: parseDatabases(r.stdout), schema: null };
}

export async function readSchema(ctx: DbContext, t: DbTarget, auth: DbAuth, database: string, filter: SchemaFilter = {}, o: RunOpts = {}): Promise<DbSchema> {
  const r = check(await runClient(ctx, t, auth, database, { kind: "sql", sql: schemaSql(t.engine, database, filter) }, o));
  return parseSchema(r.stdout, database, r.truncated);
}

/** «Copiar DDL» de una tabla o vista. */
export async function readDdl(ctx: DbContext, t: DbTarget, auth: DbAuth, database: string, schema: string, table: string): Promise<string> {
  const action: ClientAction =
    t.engine === "postgres" ? { kind: "pgdump", pattern: pgDumpPattern(schema, table) } : { kind: "sql", sql: ddlSql(t.engine, database, table) };
  const r = check(await runClient(ctx, t, auth, database, action));
  return parseDdl(t.engine, r.stdout);
}
