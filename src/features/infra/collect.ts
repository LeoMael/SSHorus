// Mapa de infraestructura: lectura de un servidor conectado. Reutiliza los scripts de Administración
// (Puertos y Sitios web) y de Contenedores (`readAllContainers`: también los de otros usuarios con sudo). Solo lectura: nada
// se instala ni se cambia en el servidor.
import { errorMessage } from "../../api/core";
import { PORTS_SCRIPT, WEB_SCRIPT, parsePorts, parseWeb } from "../admin";
import {
  canElevate,
  computeElevation,
  detectPrivilege,
  getPrivilege,
  getSudoPassword,
  obtainSudoPassword,
  readElevated,
  runScript,
  sudoPasswordNeeded,
  type Elevation,
} from "../privileges";
import type { ServerSnapshot } from "./graph";
import { NO_SUDO_NOTE } from "./owner";
import { INFRA_SCRIPT, USER_SERVICES_SCRIPT, configOwnersScript, parseConfigOwners, parseInfra, parseUnits, type HumanUser } from "./parse";

const NONE: Elevation = { kind: "none" };

export interface CollectTarget {
  profileId: string;
  name: string;
  host: string;
  sessionId: string;
}

/** Servicios `systemctl --user` de los demás usuarios (con sudo, entrando como cada uno). */
async function readUserServices(sessionId: string, el: Elevation, humans: HumanUser[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const list = humans.filter((h) => h.runtimeDir && h.home.startsWith("/"));
  if (list.length === 0) return out;
  const c = await import("../containers");
  const owners = list.map((h) => ({ kind: "user" as const, user: { name: h.name, uid: h.uid, home: h.home, podman: true, docker: false, runtimeDir: true } }));
  const runner = {
    sessionId,
    engine: "podman" as const,
    fallback: c.OWNER_SELF,
    resolve: (k: string) => c.findOwner(owners, k),
    elevationFor: () => el,
    label: (o: { kind: string; user?: { name: string } }) => o.user?.name ?? "",
  };
  const per = await c.readOwners(runner, owners, USER_SERVICES_SCRIPT, 20);
  for (const o of owners) {
    const r = per.get(c.ownerKey(o));
    const units = r?.ok && r.result ? parseUnits(r.result.stdout.split("\n")) : [];
    if (units.length) out[o.user.name] = units;
  }
  return out;
}

/** Dueño de los archivos de configuración de los servidores web (se ven sin sudo). */
async function readConfigOwners(sessionId: string, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const r = await runScript(sessionId, configOwnersScript(paths), NONE, "", 10).catch(() => null);
  return r ? parseConfigOwners(r.stdout) : {};
}

/**
 * Lee un servidor conectado. Con sudo (contraseña guardada o de otra pestaña, sin preguntar) se ve todo.
 * `elevate: false` (asistentes por MCP): como el usuario conectado, igual que list_ports.
 */
export async function collectServer(t: CollectTarget, opts: { elevate?: boolean } = {}): Promise<ServerSnapshot> {
  const snap: ServerSnapshot = {
    id: t.profileId,
    name: t.name,
    host: t.host,
    sessionId: t.sessionId,
    error: null,
    elevated: false,
    me: null,
    ports: null,
    web: null,
    containers: [],
    extra: null,
    userServices: {},
    notes: [],
  };
  try {
    const known = getPrivilege(t.sessionId);
    const info = known && known.level !== "unknown" ? known : await detectPrivilege(t.sessionId);
    snap.me = info.user;
    snap.canSudo = canElevate(info.level);
    const elevate = opts.elevate !== false;
    if (elevate && sudoPasswordNeeded(info)) await obtainSudoPassword(t.sessionId, t.profileId).catch(() => null);
    const el = elevate ? computeElevation(info, getSudoPassword(t.sessionId)).elevation : null;
    const isRoot = info.level === "root";
    const [ports, web, infra] = await Promise.all([
      readElevated(t.sessionId, PORTS_SCRIPT, el, 25),
      readElevated(t.sessionId, WEB_SCRIPT, el, 40).catch(() => null),
      readElevated(t.sessionId, INFRA_SCRIPT, el, 25).catch(() => null),
    ]);
    const elevated = ports.elevated;
    snap.elevated = elevated || isRoot;
    snap.ports = parsePorts(ports.result.stdout);
    snap.web = web ? parseWeb(web.result.stdout) : null;
    snap.extra = infra ? parseInfra(infra.result.stdout) : null;
    const usedEl = elevated ? el : isRoot ? NONE : null;
    const [containers, configOwners] = await Promise.all([
      import("../containers/readAll")
        .then((m) => m.readAllContainers(t.sessionId, usedEl, info.user, isRoot, snap.notes))
        .catch((e) => {
          snap.notes.push(`Contenedores: ${errorMessage(e)}`);
          return [];
        }),
      readConfigOwners(t.sessionId, snap.web?.servers.map((w) => w.configPath) ?? []),
    ]);
    snap.containers = containers;
    snap.configOwners = configOwners;
    // Servicios de usuario: los propios siempre; los de los demás, con sudo.
    if (snap.extra) {
      let own = snap.extra.userServices;
      if (elevated && !isRoot) {
        const r = await runScript(t.sessionId, USER_SERVICES_SCRIPT, NONE, "", 15).catch(() => null);
        own = r ? parseUnits(r.stdout.split("\n")) : [];
      }
      if (info.user && own.length && !isRoot) snap.userServices[info.user] = own;
      if (usedEl) {
        const others = [...snap.extra.humans.values()].filter((h) => h.name !== info.user);
        Object.assign(snap.userServices, await readUserServices(t.sessionId, usedEl, others).catch(() => ({})));
      }
    }
    if (!snap.elevated) snap.notes.unshift(NO_SUDO_NOTE);
  } catch (e) {
    snap.error = errorMessage(e);
  }
  return snap;
}
