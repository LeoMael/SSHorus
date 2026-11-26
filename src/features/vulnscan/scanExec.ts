// Ejecutar una fase del análisis en el servidor: con su execId (para que «Cancelar» la detenga), un solo
// intento con una contraseña de sudo rechazada y la salida tal cual para el motor.
import { isApiError } from "../../api/core";
import { newExecId } from "../../api/snippets";
import type { ExecResult } from "../../api/types";
import { vulnscan, type RawOutput, type ScriptRequest } from "../../api/vulnscan";
import { ElevationError, runScript } from "../privileges/run";
import type { Elevation } from "../privileges";
import { patchRun } from "./scanState";

/** Lo necesario para cancelar el análisis en curso de cada sesión. */
export const live = new Map<string, { scanId: string; execId: string | null; canceled: boolean; sudoBad?: boolean }>();

/** sudo rechazó la contraseña durante el análisis. `runScript` ya la olvidó y, si era la guardada (o la de
 * la conexión), la dejó «failed»: Administración muestra el mismo aviso y ofrece escribir otra. */
export function markSudoRejected(sessionId: string) {
  const l = live.get(sessionId);
  if (l) l.sudoBad = true;
  patchRun(sessionId, (r) => ({ ...r, sudoRejected: true }));
}

export class Canceled extends Error {
  constructor() {
    super("Análisis cancelado");
  }
}

export function raw(r: ExecResult): RawOutput {
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, truncated: r.truncated };
}

export const EMPTY: RawOutput = { stdout: "", stderr: "", exitCode: null, timedOut: false, truncated: false };

/** Una fase en el servidor con su execId (para poder cancelarla). */
export async function exec(sessionId: string, req: ScriptRequest, el: Elevation, timeout: number): Promise<ExecResult> {
  const l = live.get(sessionId);
  if (l?.canceled) throw new Canceled();
  // Un solo intento fallido por análisis: cada contraseña rechazada cuenta para sudo (y puede bloquear la cuenta).
  if (l?.sudoBad && el.kind === "password") throw new ElevationError("bad-password");
  const script = await vulnscan.script(req);
  const execId = newExecId();
  if (l) l.execId = execId;
  try {
    return await runScript(sessionId, script, el, "", timeout, execId);
  } catch (e) {
    if (isApiError(e, "Canceled") || live.get(sessionId)?.canceled) throw new Canceled();
    if (e instanceof ElevationError && e.failure === "bad-password") markSudoRejected(sessionId);
    throw e;
  } finally {
    if (l) l.execId = null;
  }
}
