// Comandos de una tarea en el servidor que «Cancelar» detiene de verdad: el comando va en su propio grupo
// de procesos (remoteScript.ts) y, al cancelar (o si se pasa de tiempo), se mata ese grupo con el MISMO
// usuario que lo lanzó (root con sudo, el dueño de los contenedores…), porque la señal del canal SSH no
// llega a lo que corre como otro usuario. Después se corta el canal.
import { isApiError } from "../../api/core";
import { newExecId, snippets } from "../../api/snippets";
import type { ExecResult } from "../../api/types";
import { runScript, type Elevation } from "../privileges";
import { jobScript, killJobScript, PARTIAL_STOP } from "./remoteScript";
import { JobCanceled, type JobCtx } from "./run";

export interface KillableExec<R> {
  /** Envuelve el script para su dueño (p. ej. entrar como otro usuario); por defecto va tal cual. */
  wrap?: (script: string) => Promise<string> | string;
  /** Ejecuta un script ya envuelto: el de la tarea (`run`, con su execId y en vivo) o el de pararla (null). */
  exec: (script: string, run: { execId: string; timeoutSecs: number } | null) => Promise<R>;
  /** Si el resultado dice que se pasó de tiempo (entonces también se mata el grupo). */
  timedOut?: (r: R) => boolean;
  /** Salida de un resultado (para saber si la parada fue completa). */
  stdout?: (r: R) => string;
}

/** Lo que se avisa si el servidor no pudo parar todo (sin `setsid` ni forma de listar los hijos). */
export const PARTIAL_STOP_TEXT =
  "\nAviso: no se pudo detener todo en el servidor (falta setsid y no se pueden listar sus procesos): puede que algo siga en marcha.\n";

/** Ejecuta `inner` como parte de la tarea: «Cancelar» lo detiene en el servidor. Lanza `JobCanceled`. */
export async function runKillable<R>(ctx: JobCtx, inner: string, timeoutSecs: number, x: KillableExec<R>): Promise<R> {
  ctx.check();
  const wrap = x.wrap ?? ((s: string) => s);
  const tag = newExecId();
  const script = await wrap(jobScript(tag, inner));
  ctx.check();
  const execId = newExecId();
  const kill = async () => {
    try {
      const r = await x.exec(await wrap(killJobScript(tag)), null);
      if (x.stdout?.(r).includes(PARTIAL_STOP)) ctx.output(PARTIAL_STOP_TEXT);
    } catch {
      /* ya terminó o se perdió la conexión: no queda nada que parar */
    }
  };
  const off = ctx.onCancel(async () => {
    await kill();
    await snippets.cancelExec(execId).catch(() => false);
  });
  try {
    const r = await x.exec(script, { execId, timeoutSecs });
    // Al cancelar, el grupo muere y el canal termina «bien» (código 143): no es un resultado.
    if (ctx.canceled) throw new JobCanceled();
    if (x.timedOut?.(r)) await kill();
    return r;
  } catch (e) {
    if (ctx.canceled || e instanceof JobCanceled || isApiError(e, "Canceled")) throw new JobCanceled();
    throw e;
  } finally {
    off();
  }
}

/**
 * `inner` con esa elevación (root con la contraseña de sudo guardada, o tu usuario), con la salida en
 * vivo en la tarea (o en `onOutput`; null = sin salida en vivo). Lanza `ElevationError` si falla sudo y
 * `JobCanceled` si se canceló.
 */
export function runElevated(
  ctx: JobCtx,
  sessionId: string,
  inner: string,
  el: Elevation,
  timeoutSecs: number,
  onOutput: ((text: string) => void) | null = ctx.output,
): Promise<ExecResult> {
  return runKillable(ctx, inner, timeoutSecs, {
    exec: (s, run) => runScript(sessionId, s, el, "", run?.timeoutSecs ?? 30, run?.execId, run && onOutput ? onOutput : undefined),
    timedOut: (r) => r.timedOut,
    stdout: (r) => r.stdout,
  });
}
