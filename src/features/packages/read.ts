// Paquetes: leer las actualizaciones (con sudo si se puede: dnf y apt ven así la caché del sistema),
// buscar, comprobar lo instalado y simular un «quitar». Lo leído queda guardado por sesión.
import { splitSections } from "../../lib/remote";
import { sessionCache } from "../admin";
import { failureText, readElevated, refreshPrivilege, runScript, sudoRejected, type Elevation } from "../privileges";
import { installedScript, searchScript, simulateRemoveScript, updatesScript } from "./managers";
import { parseUpdatesOutput, type PkgManager, type UpdatesRead } from "./parse";
import { markInstalled, parseRemoval, parseSearch, removalBlocked, validPackage, type Found } from "./search";

export interface PackagesRead extends UpdatesRead {
  elevated: boolean;
  elevationError: string | null;
}

export const packagesCache = sessionCache<PackagesRead>();

/** `refresh`: bajar antes la lista nueva de paquetes (tarda más y necesita root en apt/zypper/apk). */
export function loadPackages(sessionId: string, el: Elevation | null, refresh = false): Promise<void> {
  return packagesCache.load(sessionId, async () => {
    const r = await readElevated(sessionId, updatesScript(refresh), el, refresh ? 300 : 180);
    if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
    if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
    return { ...parseUpdatesOutput(r.result.stdout), elevated: r.elevated, elevationError: r.elevationError?.message ?? null };
  });
}

type Real = Exclude<PkgManager, "none">;

/** Busca paquetes (como tu usuario) y marca los instalados. */
export async function searchPackages(sessionId: string, m: Real, term: string): Promise<Found[]> {
  const t = term.trim();
  if (!validPackage(t)) throw new Error("Escribe una palabra sin espacios (letras, números, «.», «-», «_» o «+»)");
  const none: Elevation = { kind: "none" };
  const r = await runScript(sessionId, searchScript(m, t), none, "", 90);
  const s = splitSections(r.stdout);
  if (!s.has("end")) throw new Error(failureText(r));
  const found = parseSearch(m, s.get("found") ?? []);
  const inst = installedScript(m, found.filter((f) => f.installed === null).map((f) => f.name));
  if (!inst) return found;
  const ri = await runScript(sessionId, inst, none, "", 30);
  return markInstalled(found, splitSections(ri.stdout).get("inst") ?? []);
}

export interface RemovalPreview {
  /** Lo que se quitaría (null si no se pudo saber). */
  removed: string[] | null;
  /** El gestor se niega a quitarlo (paquete protegido o esencial): por qué. */
  blocked: string | null;
}

/** Simula el «quitar» (dnf necesita root hasta para simular). */
export async function simulateRemove(sessionId: string, m: Real, name: string, el: Elevation | null): Promise<RemovalPreview> {
  if (!validPackage(name)) return { removed: null, blocked: null };
  try {
    const r = await readElevated(sessionId, simulateRemoveScript(m, name), el, 90);
    const lines = splitSections(r.result.stdout).get("sim") ?? [];
    const names = parseRemoval(m, lines);
    return { removed: names.length ? names : null, blocked: removalBlocked(lines) };
  } catch {
    return { removed: null, blocked: null };
  }
}
