// Leer la configuración del servidor: CONFIG_SCRIPT con sudo si se puede (si no, como tu usuario) y, a
// la vez, la lectura corta sin sudo de la Auditoría (GUARD_SCRIPT) para saber desde qué IP te conectas.
// El resultado queda guardado por sesión (al volver a la sub-pestaña se ve al instante).
import { create } from "zustand";
import { errorMessage } from "../../api/core";
import { splitSections } from "../../lib/remote";
import { GUARD_SCRIPT } from "../audit/fixSafety";
import { readElevated, refreshPrivilege, runScript, sudoRejected, type Elevation } from "../privileges";
import { buildConfig } from "./build";
import type { ServerConfig } from "./model";
import { CONFIG_SCRIPT } from "./script";

const READ_TIMEOUT_SECS = 120;

/** Primer campo de $SSH_CONNECTION (la IP de este equipo vista desde el servidor). */
export function clientIp(guardStdout: string): string | null {
  const ip = ((splitSections(guardStdout).get("who") ?? [])[1] ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[0-9A-Fa-f.:]{2,45}$/.test(ip) ? ip : null;
}

export interface ConfigRead {
  config: ServerConfig;
  at: number;
  /** Se intentó con sudo y falló: por qué (se leyó sin sudo). */
  elevationError: string | null;
}

export async function readServerConfig(sessionId: string, elevation: Elevation | null): Promise<ConfigRead> {
  const [r, guard] = await Promise.all([
    readElevated(sessionId, CONFIG_SCRIPT, elevation, READ_TIMEOUT_SECS),
    runScript(sessionId, GUARD_SCRIPT, { kind: "none" }, "", 15).catch(() => null),
  ]);
  if (r.elevationError?.failure === "need-password") refreshPrivilege(sessionId);
  if (r.elevationError?.failure === "bad-password") sudoRejected(sessionId);
  return {
    config: buildConfig(r.result.stdout, r.elevated, guard ? clientIp(guard.stdout) : null),
    at: Date.now(),
    elevationError: r.elevationError?.message ?? null,
  };
}

interface Entry {
  data: ConfigRead | null;
  loading: boolean;
  error: string | null;
}

interface State {
  bySession: Record<string, Entry>;
}

export const useServerConfig = create<State>(() => ({ bySession: {} }));

const EMPTY: Entry = { data: null, loading: false, error: null };
const gens = new Map<string, number>();

function patch(sessionId: string, p: Partial<Entry>) {
  useServerConfig.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: { ...(s.bySession[sessionId] ?? EMPTY), ...p } } }));
}

export function configEntry(s: State, sessionId: string): Entry {
  return s.bySession[sessionId] ?? EMPTY;
}

/** Lee (o vuelve a leer) y lo guarda; si se lanzan dos seguidas, solo cuenta la última. */
export async function loadServerConfig(sessionId: string, elevation: Elevation | null): Promise<void> {
  const g = (gens.get(sessionId) ?? 0) + 1;
  gens.set(sessionId, g);
  patch(sessionId, { loading: true, error: null });
  try {
    const data = await readServerConfig(sessionId, elevation);
    if (gens.get(sessionId) === g) patch(sessionId, { data, loading: false });
  } catch (e) {
    if (gens.get(sessionId) === g) patch(sessionId, { loading: false, error: errorMessage(e) });
  }
}
