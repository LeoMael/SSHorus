// Leer los servicios (del sistema o `--user` de un usuario) y el registro de uno, guardando lo leído por
// sesión para que se vea al instante al volver a la sub-pestaña.
import { newExecId, snippets } from "../../api/snippets";
import { splitSections } from "../../lib/remote";
import { sessionCache } from "../admin";
import { failureText, readElevated, refreshPrivilege, runScript, succeeded, sudoRejected, type Elevation } from "../privileges";
import { parseServices, parseUserServices, type HumanUser, type Service, type ServicesRead } from "./parse";
import { logsScript, ownLogsScript, SERVICES_SCRIPT, USER_SERVICES_SCRIPT, userServicesAsRoot, type LogTarget } from "./script";

const NONE: Elevation = { kind: "none" };

export interface SystemServices extends ServicesRead {
  elevationError: string | null;
}

export const systemServices = sessionCache<SystemServices>();

export function loadSystemServices(sessionId: string, el: Elevation | null): Promise<void> {
  return systemServices.load(sessionId, async () => {
    const r = await readElevated(sessionId, SERVICES_SCRIPT, el, 40);
    if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
    if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
    return { ...parseServices(r.result.stdout), elevationError: r.elevationError?.message ?? null };
  });
}

export interface UserServices {
  /** null = su gestor de servicios no respondió (sin sesión ni linger). */
  services: Service[] | null;
  error: string | null;
}

export const userServices = sessionCache<UserServices>();

export const userKey = (sessionId: string, user: string) => `${sessionId}|${user}`;

/** Servicios `--user`: los tuyos sin sudo; los de otro usuario, entrando como él con sudo. */
export function loadUserServices(sessionId: string, el: Elevation | null, user: HumanUser, me: string | null): Promise<void> {
  return userServices.load(userKey(sessionId, user.name), async () => {
    const mine = user.name === me;
    if (!mine && (!el || el.kind === "none")) throw new Error("Hace falta sudo para ver los servicios de otro usuario");
    const r = await runScript(sessionId, mine ? USER_SERVICES_SCRIPT : userServicesAsRoot(user), mine ? NONE : el!, "", 30);
    if (!splitSections(r.stdout).has("end")) throw new Error(failureText(r));
    const services = parseUserServices(r.stdout);
    const err = (splitSections(r.stdout).get("err") ?? []).join("\n").trim();
    return { services, error: services ? null : err || "Su gestor de servicios no responde" };
  });
}

/** Últimas líneas del registro de un servicio. Con sudo se ve todo; sin él, lo que deje el sistema. */
export async function readLogs(sessionId: string, el: Elevation | null, t: LogTarget, me: string | null, lines = 200): Promise<string> {
  const mine = !!t.user && t.user.name === me && (!el || el.kind === "none");
  if (t.user && !mine && (!el || el.kind === "none")) throw new Error("Hace falta sudo para leer el registro de otro usuario");
  const script = mine ? ownLogsScript(t.unit, lines) : logsScript(t, lines);
  const r = mine ? await runScript(sessionId, script, NONE, "", 30) : (await readElevated(sessionId, script, el, 30)).result;
  const s = splitSections(r.stdout, { blank: "keep" });
  if (!s.has("end")) throw new Error(failureText(r));
  return (s.get("log") ?? []).join("\n").trim();
}

/**
 * Sigue el registro en vivo (hasta 5 minutos). Devuelve cómo pararlo. Necesita root para un servicio
 * del sistema que tu usuario no puede leer (sin sudo se intenta igual).
 */
export function followLogs(
  sessionId: string,
  el: Elevation | null,
  t: LogTarget,
  onText: (text: string) => void,
  onEnd: (error: string | null) => void,
): () => void {
  const execId = newExecId();
  let stopped = false;
  runScript(sessionId, logsScript(t, 0, true), el ?? NONE, "", 330, execId, (text) => onText(text))
    .then((r) => onEnd(stopped || succeeded(r) || r.exitCode === 124 ? null : failureText(r)))
    .catch((e) => onEnd(stopped ? null : e instanceof Error ? e.message : String(e)));
  return () => {
    stopped = true;
    void snippets.cancelExec(execId).catch(() => false);
  };
}
