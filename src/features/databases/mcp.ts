// `get_db_schema` del asistente de IA (petición `db-schema` del motor). Mismo camino que la pestaña, pero
// como el usuario conectado y sin sudo (como list_ports): credencial guardada o entrar sin contraseña. La
// contraseña la lee la interfaz de la bóveda o el llavero y va por stdin al servidor: el asistente solo
// recibe el esquema.
import { dbCreds } from "../../api/db";
import { useProfiles } from "../../stores/profiles";
import { detectPrivilege, getPrivilege, type Elevation } from "../privileges";
import { authLabel } from "./auth";
import { sqliteTarget } from "./discover";
import { DbAuthError, discoverDatabases, openTarget, readSchema, type DbContext, type Discovery } from "./remote";
import { useDbDiscovery } from "./store";
import type { DbSchema, DbTarget } from "./types";

interface Request {
  sessionId: string;
  profileId: string;
  target: string | null;
  database: string | null;
  schema: string | null;
  table: string | null;
}

function text(p: Record<string, unknown>, k: string): string | null {
  const v = p[k];
  return typeof v === "string" && v ? v : null;
}

function request(p: Record<string, unknown>): Request {
  const sessionId = text(p, "sessionId");
  const profileId = text(p, "profileId");
  if (!sessionId || !profileId) throw new Error("Falta la conexión");
  return { sessionId, profileId, target: text(p, "target"), database: text(p, "database"), schema: text(p, "schema"), table: text(p, "table") };
}

/** Lo que ve el asistente de un destino (sin contraseñas). */
function describe(t: DbTarget, saved: Set<string>) {
  const where =
    t.place.kind === "host"
      ? { kind: "server", host: t.place.host, port: t.place.port }
      : t.place.kind === "container"
        ? { kind: "container", engine: t.place.engine, name: t.place.name, image: t.place.image, user: t.place.user }
        : { kind: "file", path: t.place.path };
  return { key: t.key, engine: t.engine, label: t.label, where, savedCredential: saved.has(t.key), problem: t.problem };
}

/** Solo la tabla pedida (SQLite se lee entero: es un archivo). */
function onlyTable(s: DbSchema, table: string | null): DbSchema {
  return table ? { ...s, tables: s.tables.filter((t) => t.name === table) } : s;
}

export async function dbSchemaForAssistant(payload: Record<string, unknown>): Promise<unknown> {
  const r = request(payload);
  const known = getPrivilege(r.sessionId);
  const info = known && known.level !== "unknown" ? known : await detectPrivilege(r.sessionId);
  const isRoot = info.level === "root";
  const elevation: Elevation | null = isRoot ? { kind: "root" } : null;
  const ctx: DbContext = { sessionId: r.sessionId, elevation };
  const sshPort = useProfiles.getState().servers.find((s) => s.id === r.profileId)?.port ?? 22;
  const discover = async (): Promise<Discovery> =>
    useDbDiscovery.getState().discovery[r.sessionId] ?? (await discoverDatabases(r.sessionId, { elevation, me: info.user, isRoot, sshPort }));

  if (!r.target) {
    const d = await discover();
    const saved = new Set(await dbCreds.targets(r.profileId).catch(() => []));
    return {
      targets: d.targets.map((t) => describe(t, saved)),
      note: "Los archivos SQLite no se buscan: pásalos con sqlite_path. Usa el key de un destino como target.",
    };
  }
  const t = r.target.startsWith("sqlite@") ? sqliteTarget(r.target.slice("sqlite@".length), null) : (await discover()).targets.find((x) => x.key === r.target);
  if (!t) throw new Error(`No se encontró la base «${r.target}». Llama a get_db_schema sin target para ver las que hay.`);
  const saved = await dbCreds.get(r.profileId, t.key).catch(() => null);
  try {
    const opened = await openTarget(ctx, t, saved);
    const how = authLabel(t, opened.auth);
    if (opened.schema) return { target: t.key, access: how, ...onlyTable(opened.schema, r.table) };
    if (!r.database) return { target: t.key, access: how, version: opened.list?.version ?? null, databases: opened.list?.databases ?? [] };
    const schema = await readSchema(ctx, t, opened.auth, r.database, { schema: r.schema, table: r.table });
    return { target: t.key, access: how, ...schema };
  } catch (e) {
    if (e instanceof DbAuthError) {
      throw new Error(
        `No se pudo entrar en «${t.label}» sin contraseña. Pide al usuario que abra SSHorus → Bases de datos, elija esa base, ` +
          "pulse «Entrar con usuario y contraseña» y marque «Guardar»; después vuelve a intentarlo.",
        { cause: e },
      );
    }
    throw e;
  }
}
