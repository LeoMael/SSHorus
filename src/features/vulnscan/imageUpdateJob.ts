// «Actualizar imagen» como tarea en segundo plano: los pasos automáticos (descargar, Compose, systemd)
// como el dueño de la imagen, con la salida en vivo y «Cancelar» que detiene el paso también en el
// servidor (como ese dueño). Si no hay contenedores creados a mano que revisar, la tarea vuelve a
// analizar la imagen al final; si los hay, eso lo sigue haciendo el diálogo (con su formulario).
import { errorMessage } from "../../api/core";
import type { Engine, Report, Target, UserCtx } from "../../api/vulnscan";
import { getJob } from "../../stores/jobs";
import { COMPOSE_OUTPUT } from "../containers/composeOutput";
import { failureMessage } from "../containers/run";
import { JobCanceled, runKillable, startJob, type Job, type JobAction, type JobCtx, type JobResult } from "../jobs";
import { ElevationError, runScript, type Elevation } from "../privileges";
import { rescanMessage, stepScript, type UpdatePlan } from "./imageUpdate";
import { useVulnScan } from "./run";
import { ownerScript, rescanImage, UpdateCancel, UpdateCanceled, type RescanResult } from "./updateRun";

export const IMAGE_UPDATE_JOB = "imageupdate";
/** Un paso (descargar una imagen grande en un VPS lento, recrear con Compose) puede tardar. */
const STEP_TIMEOUT_SECS = 900;

export interface ImageUpdateData {
  /** Contenedores creados a mano que aún hay que reemplazar (con el formulario del diálogo). */
  pendingRun: string[];
  rescan: RescanResult | null;
  needSudo: boolean;
}

export interface ImageUpdateRequest {
  sessionId: string;
  report: Report;
  target: Target;
  plan: UpdatePlan;
  tag: string;
  engine: Engine;
  user: UserCtx | null;
  el: Elevation;
  /** De quién es la imagen, para la lista. */
  who: string;
  useOsv: boolean;
  useTrivy: boolean;
  actions?: (data: ImageUpdateData) => JobAction[];
}

/** El diálogo que sigue la tarea pone el informe nuevo al cerrarse (si no, el hallazgo desaparece con él). */
const watching = new Set<string>();

function applyReport(job: Job | undefined) {
  const r = (job?.data as ImageUpdateData | undefined)?.rescan?.report;
  if (job?.sessionId && r) useVulnScan.getState().setReport(job.sessionId, r);
}

/** El diálogo empieza a seguir la tarea. Devuelve la baja (al cerrarse), que pone el informe nuevo. */
export function watchImageUpdate(id: string): () => void {
  watching.add(id);
  return () => {
    watching.delete(id);
    applyReport(getJob(id));
  };
}

async function runSteps(ctx: JobCtx, req: ImageUpdateRequest): Promise<void> {
  for (const [i, step] of req.plan.steps.entries()) {
    ctx.step(i);
    ctx.phase(`${step.label}…`);
    ctx.output(`── ${step.label}\n`);
    const r = await runKillable(ctx, stepScript(step), STEP_TIMEOUT_SECS, {
      wrap: (s) => ownerScript(req.engine, req.user, s),
      exec: (s, run) => runScript(req.sessionId, s, req.el, "", run?.timeoutSecs ?? 30, run?.execId, run ? ctx.output : undefined),
      timedOut: (x) => x.timedOut,
    });
    if (r.exitCode !== 0 || r.timedOut) throw new Error(failureMessage(r));
  }
}

async function rescan(ctx: JobCtx, req: ImageUpdateRequest): Promise<RescanResult> {
  ctx.step(req.plan.steps.length);
  const c = new UpdateCancel();
  const off = ctx.onCancel(() => c.cancel());
  try {
    return await rescanImage({ ...req, cancel: c, onProgress: (t) => ctx.phase(t) });
  } catch (e) {
    if (e instanceof UpdateCanceled) throw new JobCanceled();
    throw e;
  } finally {
    off();
  }
}

async function runImageUpdate(ctx: JobCtx, req: ImageUpdateRequest): Promise<JobResult> {
  const pendingRun = req.plan.groups.flatMap((g) => (g.kind === "run" ? [g.container.name] : []));
  const data: ImageUpdateData = { pendingRun, rescan: null, needSudo: false };
  const end = (r: JobResult): JobResult => ({ ...r, actions: req.actions?.(r.data as ImageUpdateData) ?? [] });
  try {
    await runSteps(ctx, req);
    if (pendingRun.length) {
      return end({
        summary: `Imagen descargada. Faltan los contenedores creados a mano (${pendingRun.join(", ")}): revísalos en «Actualizar imagen» para reemplazarlos.`,
        data,
      });
    }
    const r = await rescan(ctx, req);
    return end({ summary: rescanMessage(r.remaining), data: { ...data, rescan: r } });
  } catch (e) {
    if (e instanceof JobCanceled) throw e;
    const needSudo = e instanceof ElevationError && (e.failure === "need-password" || e.failure === "bad-password");
    return end({ status: "failed", error: e instanceof ElevationError ? e.message : errorMessage(e), data: { ...data, needSudo } });
  }
}

/** Empieza los pasos automáticos y devuelve el id de la tarea. */
export function startImageUpdate(req: ImageUpdateRequest): string {
  const pending = req.plan.groups.some((g) => g.kind === "run");
  const labels = req.plan.steps.map((s) => s.label);
  return startJob({
    kind: IMAGE_UPDATE_JOB,
    sessionId: req.sessionId,
    title: "Actualizar imagen",
    detail: `${req.tag} · de ${req.who}`,
    key: req.target.key,
    pane: "admin",
    steps: pending ? labels : [...labels, "Volver a analizar"],
    output: COMPOSE_OUTPUT,
    data: { pendingRun: [], rescan: null, needSudo: false } satisfies ImageUpdateData,
    run: (ctx) => runImageUpdate(ctx, req),
    onFinished: (job) => {
      if (!watching.has(job.id)) applyReport(job);
    },
  });
}

export function imageUpdateData(job: Job | null | undefined): ImageUpdateData | null {
  return job?.kind === IMAGE_UPDATE_JOB ? (job.data as ImageUpdateData) : null;
}
