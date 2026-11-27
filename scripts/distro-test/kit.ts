// Piezas comunes de las áreas de la batería por distro (`npm run test:distros`): lo que se espera de
// cada distro, cómo se ejecuta un script (como lo haría una conexión SSH) y cómo se da por bueno.
import { buildExec, elevationFailure, elevationFailureMessage, type Elevation } from "../../src/features/privileges/elevate";

/** Lo que se espera de cada distro (lo rellena la tabla de run.mjs). */
export interface Expect {
  /** `ID` de /etc/os-release. */
  osId: string;
  family: string;
  adminGroup: string;
  /** Usuario de prueba (con contraseña y en el grupo de administración). */
  user: string;
  password: string;
  /** Hay nginx instalado (en el resto, «Sitios web» debe decir que no hay). */
  web: boolean;
}

/** Una ejecución en el servidor: el comando del canal exec y lo que va por stdin (como `snippets.execStdin`). */
export interface Run {
  command: string;
  stdin: string;
  timeoutSecs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface Verdict {
  ok: boolean;
  detail: string;
  /** Líneas de más que se enseñan con --detalle (p. ej. las comprobaciones de la auditoría que no salen bien). */
  extra?: string[];
}

export interface Area {
  id: string;
  label: string;
  runs: (e: Expect) => Run[];
  check: (r: RunResult[], e: Expect) => Verdict;
}

/** Excepción que se convierte en ✗ con su motivo. */
export class Fail extends Error {}

export function must(cond: unknown, why: string): asserts cond {
  if (!cond) throw new Fail(why);
}

export const sudo = (e: Expect): Elevation => ({ kind: "password", password: e.password });
export const none: Elevation = { kind: "none" };

/** Como `runScript`: el script va por stdin con el arranque corto de `buildExec`. */
export function script(inner: string, el: Elevation, timeoutSecs = 60): Run {
  const req = buildExec(inner, el);
  return { command: req.command, stdin: req.stdin, timeoutSecs };
}

/** Comando del canal exec tal cual (detección de privilegios y muestreo del monitor). */
export function raw(command: string, timeoutSecs = 30): Run {
  return { command, stdin: "", timeoutSecs };
}

/** Falla si sudo no funcionó (contraseña, sudoers…) o si el script no terminó. */
export function finished(r: RunResult, what: string): string {
  const f = elevationFailure(r.exitCode, r.stderr);
  must(!f, `${what}: ${f ? elevationFailureMessage(f) : ""}`);
  must(!r.timedOut, `${what}: tardó demasiado`);
  must(r.stdout.includes("@@end"), `${what}: salida incompleta (código ${r.exitCode}; ${r.stderr.trim().slice(0, 160) || "sin stderr"})`);
  return r.stdout;
}

