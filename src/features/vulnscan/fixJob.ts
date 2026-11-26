// «Arreglar» del escáner como tarea en segundo plano (en un VPS pequeño `dnf upgrade` tarda): actualizar
// los paquetes como root (salida en vivo, progreso si dnf lo dice, límite de FIX_TIMEOUT_SECS y
// «Cancelar» que lo detiene también en el servidor), buscar servicios que reiniciar y volver a comprobar.
// El resultado, paquete por paquete (arreglado / falta reiniciar / sin versión corregida en tus repos /
// falló con la línea de dnf), queda en los datos de la tarea (fixOutcome.ts).
import { errorMessage } from "../../api/core";
import type { Finding, Report, VulnScanSettings } from "../../api/vulnscan";
import { JobCanceled, runElevated, startJob, type Job, type JobAction, type JobCtx, type JobResult } from "../jobs";
import { ElevationError, failureText, type Elevation } from "../privileges";
import { crossReports, type CrossResult } from "./crossCheck";
import { fixOutcomes, nothingInstalled, outcomeSummary, upgradeIssues, type PackageOutcome } from "./fixOutcome";
import { upgradeProgress } from "./fixPlan";
import { checkRestart, FIX_TIMEOUT_SECS, recheckSystem } from "./fixRun";
import type { RestartInfo } from "./restart";
import { useVulnScan } from "./scanState";
import { UpdateCancel, UpdateCanceled } from "./updateRun";

export const VULNFIX_JOB = "vulnfix";
export const VULNFIX_STEPS = ["Actualizar paquetes", "Buscar servicios que reiniciar", "Volver a comprobar"] as const;

export interface VulnFixData {
  el: Elevation;
  result: CrossResult | null;
  /** Una fila por paquete: qué pasó de verdad. */
  outcomes: PackageOutcome[] | null;
  restart: RestartInfo | null;
  /** Informe nuevo (tras volver a comprobar). */
  report: Report | null;
  needSudo: boolean;
}

export interface VulnFixRequest {
  sessionId: string;
  report: Report;
  /** Hallazgos que se quieren arreglar (para decir cuáles quedaron). */
  scope: Finding[];
  command: string;
  packages: string[];
  el: Elevation;
  settings: VulnScanSettings;
  view?: Job["view"];
  /** Botones al terminar (p. ej. pedir la contraseña de sudo). */
  actions?: (data: VulnFixData) => JobAction[];
}

/** Lo de después de actualizar: servicios que reiniciar e informe nuevo. Lanza `JobCanceled`. */
async function afterUpgrade(ctx: JobCtx, req: VulnFixRequest): Promise<{ restart: RestartInfo | null; next: Report }> {
  ctx.check();
  const c = new UpdateCancel();
  const off = ctx.onCancel(() => c.cancel());
  try {
    ctx.step(1);
    ctx.phase("Buscando servicios que reiniciar…", null);
    let restart: RestartInfo | null = null;
    try {
      restart = await checkRestart(req.sessionId, req.el, c);
    } catch (e) {
      if (e instanceof UpdateCanceled) throw e;
    }
    ctx.step(2);
    const next = await recheckSystem({ sessionId: req.sessionId, report: req.report, settings: req.settings, cancel: c, onProgress: (t) => ctx.phase(t) });
    return { restart, next };
  } catch (e) {
    if (e instanceof UpdateCanceled) throw new JobCanceled();
    throw e;
  } finally {
    off();
  }
}

async function runVulnFix(ctx: JobCtx, req: VulnFixRequest): Promise<JobResult> {
  const data = emptyData(req.el);
  const end = (r: JobResult): JobResult => ({ ...r, actions: req.actions?.(r.data as VulnFixData) ?? [] });
  try {
    ctx.phase("Actualizando paquetes…");
    const r = await runElevated(ctx, req.sessionId, req.command, req.el, FIX_TIMEOUT_SECS, (t) => {
      ctx.output(t);
      const p = upgradeProgress(t);
      if (p) ctx.progress(p);
    });
    // Aunque falle, se comprueba igual: puede que parte se haya actualizado.
    const failure = r.exitCode !== 0 || r.timedOut ? failureText(r) : null;
    const issues = upgradeIssues(`${r.stdout}\n${r.stderr}`, req.scope.flatMap((f) => [...f.binaries, f.package]));
    const { restart, next } = await afterUpgrade(ctx, req);
    useVulnScan.getState().setReport(req.sessionId, next);
    const outcomes = fixOutcomes(req.scope, next, restart, issues, failure);
    const done: VulnFixData = { ...data, result: crossReports(req.scope, next), outcomes, restart, report: next };
    // «Nothing to do» termina con código 0, pero si no se instaló nada no es un éxito.
    const error = failure ?? (nothingInstalled(outcomes) ? "No se instaló nada: tus repositorios aún no traen las versiones corregidas" : null);
    return end({ status: error ? "failed" : "done", error, summary: outcomeSummary(outcomes), data: done });
  } catch (e) {
    if (e instanceof JobCanceled) return { summary: "Puede que la actualización haya quedado a medias: pulsa «Volver a comprobar».", data };
    const needSudo = e instanceof ElevationError && (e.failure === "need-password" || e.failure === "bad-password");
    return end({ status: "failed", error: e instanceof ElevationError ? e.message : errorMessage(e), data: { ...data, needSudo } });
  }
}

function emptyData(el: Elevation): VulnFixData {
  return { el, result: null, outcomes: null, restart: null, report: null, needSudo: false };
}

/** Empieza «Arreglar» y devuelve el id de la tarea. */
export function startVulnFix(req: VulnFixRequest): string {
  const n = req.packages.length;
  return startJob({
    kind: VULNFIX_JOB,
    sessionId: req.sessionId,
    title: "Arreglar vulnerabilidades",
    detail: `${n} ${n === 1 ? "paquete" : "paquetes"}: ${req.packages.slice(0, 4).join(", ")}${n > 4 ? "…" : ""}`,
    pane: "admin",
    steps: VULNFIX_STEPS,
    data: emptyData(req.el),
    view: req.view,
    run: (ctx) => runVulnFix(ctx, req),
  });
}

/** La tarea de «Arreglar» en marcha en esa conexión (solo una a la vez: el gestor de paquetes se bloquea). */
export function runningVulnFix(jobs: Job[], sessionId: string): Job | undefined {
  return jobs.find((j) => j.kind === VULNFIX_JOB && j.sessionId === sessionId && j.status === "running");
}
