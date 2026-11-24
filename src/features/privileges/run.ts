// Ejecución de un script en el servidor con la elevación elegida (canal exec + stdin). La usan todas las
// funciones que leen o cambian el servidor (administración, contenedores, auditoría, monitor, túneles…).
import { snippets } from "../../api/snippets";
import type { ExecResult } from "../../api/types";
import { splitSections } from "../../lib/remote";
import { buildExec, elevationFailure, elevationFailureMessage, type Elevation, type ElevationFailure } from "./elevate";
import { forgetSudo, sudoRejected } from "./sudo";

/** Error de elevación (contraseña de sudo incorrecta, sudo denegado…). */
export class ElevationError extends Error {
  failure: ElevationFailure;
  constructor(failure: ElevationFailure) {
    super(elevationFailureMessage(failure));
    this.name = "ElevationError";
    this.failure = failure;
  }
}

/**
 * Ejecuta `inner` con la elevación indicada. `secret` va al stdin del script interior.
 * Si la contraseña de sudo resulta incorrecta, se olvida (`sudoRejected`) y se lanza `ElevationError`.
 * `execId` (opcional, `newExecId()`) permite cancelarlo con `snippets.cancelExec`: se detiene también
 * en el servidor y la promesa falla con el error `Canceled`. Con `execId` y `onOutput`, la salida llega
 * además según se produce (para mostrarla en vivo).
 */
export async function runScript(
  sessionId: string,
  inner: string,
  el: Elevation,
  secret = "",
  timeoutSecs = 60,
  execId?: string,
  onOutput?: (text: string, stderr: boolean) => void,
): Promise<ExecResult> {
  const req = buildExec(inner, el, secret);
  const r =
    execId && onOutput
      ? await snippets.execStdinLive(sessionId, req.command, req.stdin, timeoutSecs, execId, onOutput)
      : await snippets.execStdin(sessionId, req.command, req.stdin, timeoutSecs, execId);
  const f = elevationFailure(r.exitCode, r.stderr);
  if (f) {
    // Contraseña incorrecta: se olvida la de memoria y, si era la guardada (o la de la conexión), queda
    // «failed» para que el panel muestre el aviso y no se vuelva a probar sola (cada intento cuenta para sudo).
    if (f === "bad-password") sudoRejected(sessionId);
    else if (f === "denied") forgetSudo(sessionId);
    throw new ElevationError(f);
  }
  return r;
}

/** true si el comando salió bien. */
export function succeeded(r: ExecResult): boolean {
  return r.exitCode === 0 && !r.timedOut;
}

/** Texto de error legible a partir del resultado. */
export function failureText(r: ExecResult): string {
  if (r.timedOut) return "El comando tardó demasiado y se canceló";
  const err = r.stderr.trim();
  if (err) return err;
  return `El comando terminó con código ${r.exitCode ?? "desconocido"}`;
}

export interface ElevatedRead {
  result: ExecResult;
  /** Se leyó como root (se ve todo). */
  elevated: boolean;
  /** Si se intentó elevar y falló (contraseña de sudo incorrecta…), el motivo. */
  elevationError: ElevationError | null;
}

/**
 * Lectura con la elevación disponible (null = sin elevar). Si sudo falla, se repite como usuario normal
 * para mostrar al menos lo que se pueda ver. Exige que la salida termine en «@@end».
 */
export async function readElevated(
  sessionId: string,
  script: string,
  el: Elevation | null,
  timeoutSecs = 30,
): Promise<ElevatedRead> {
  let elevationError: ElevationError | null = null;
  let r: ExecResult | null = null;
  if (el && el.kind !== "none") {
    try {
      r = await runScript(sessionId, script, el, "", timeoutSecs);
    } catch (e) {
      if (!(e instanceof ElevationError)) throw e;
      elevationError = e;
    }
  }
  const elevated = r !== null;
  if (!r) r = await runScript(sessionId, script, { kind: "none" }, "", timeoutSecs);
  if (!splitSections(r.stdout).has("end")) throw new Error(failureText(r));
  return { result: r, elevated, elevationError };
}
