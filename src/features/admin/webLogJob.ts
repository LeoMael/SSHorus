// Poner o quitar el registro de visitas de un sitio como tarea en segundo plano: los pasos en vivo
// (revisar, copia, carpeta, editar, validar, recargar, visita de prueba), «Cancelar» que para el script
// en el servidor (que deja el archivo como estaba si aún no recargó) y una entrada en el historial.
import { errorMessage } from "../../api/core";
import { runElevated, startJob, type Job, type JobCtx, type JobResult } from "../jobs";
import { ElevationError, type Elevation } from "../privileges";
import { useAdminHistory } from "./history";
import { LogStepStream, readLogRun } from "./webLogResult";
import type { SiteLogPlan } from "./webTrafficSetup";
import type { WebServer } from "./webTypes";

export const WEBLOG_JOB = "weblog";
/** Validar y recargar suele ser cosa de segundos; con margen para un VPS de 1 vCPU ocupado. */
const TIMEOUT_SECS = 180;

export interface WebLogRequest {
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation;
  server: WebServer;
  /** Para no lanzar dos veces lo mismo sobre el mismo sitio. */
  siteKey: string;
  plan: SiteLogPlan;
  onFinished?: (job: Job) => void;
}

async function runWebLog(ctx: JobCtx, req: WebLogRequest): Promise<JobResult> {
  const { plan } = req;
  const stream = new LogStepStream((key) => {
    const i = plan.steps.findIndex((s) => s.key === key);
    if (i >= 0) {
      ctx.step(i);
      ctx.phase(`${plan.steps[i].label}…`);
    }
  }, ctx.output);
  const history = (ok: boolean, result: string) =>
    useAdminHistory.getState().add(req.profileId, { server: req.serverName, action: plan.title, command: plan.brief, ok, result });
  try {
    const r = await runElevated(ctx, req.sessionId, plan.script, req.elevation, TIMEOUT_SECS, (t) => stream.push(t));
    stream.end();
    const out = readLogRun(plan, req.server, r);
    history(out.ok, out.error ?? out.summary ?? "");
    return out.ok ? { summary: out.summary } : { status: "failed", error: out.error };
  } catch (e) {
    stream.end();
    if (e instanceof ElevationError) {
      history(false, e.message);
      return { status: "failed", error: e.message };
    }
    if (!ctx.canceled) history(false, errorMessage(e));
    throw e;
  }
}

/** Empieza la tarea y devuelve su id. */
export function startWebLog(req: WebLogRequest): string {
  return startJob({
    kind: WEBLOG_JOB,
    sessionId: req.sessionId,
    server: req.serverName,
    title: req.plan.title,
    detail: req.plan.logPath,
    key: `${WEBLOG_JOB}|${req.siteKey}`,
    pane: "admin",
    steps: req.plan.steps.map((s) => s.label),
    run: (ctx) => runWebLog(ctx, req),
    onFinished: req.onFinished,
  });
}
