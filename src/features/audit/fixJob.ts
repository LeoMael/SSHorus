// «Arreglar» de la auditoría (uno o «Arreglar todo lo seguro») como tarea en segundo plano: aplica los
// arreglos uno tras otro (salida en vivo, «Cancelar» que detiene el comando en el servidor y no empieza
// los siguientes) y después vuelve a comprobar lo tocado una sola vez, guardando el informe actualizado.
// Para si sudo pide la contraseña. El resultado de cada arreglo queda en los datos de la tarea.
import { errorMessage } from "../../api/core";
import type { AuditReport, Check } from "../../api/audit";
import { startJob, type Job, type JobAction, type JobCtx, type JobResult } from "../jobs";
import type { Elevation } from "../privileges";
import { runFix, type FixResult } from "./fixRun";
import { NO_RECHECK } from "./fixSafety";
import { fixSummary, type RecheckOutcome } from "./recheck";
import { recheckAudit, useAuditRun } from "./run";

export const AUDITFIX_JOB = "auditfix";

export interface AuditFixData {
  results: Record<string, FixResult>;
  outcomes: Record<string, RecheckOutcome>;
  /** No se pudo volver a comprobar (o no tiene sentido, p. ej. tras reiniciar). */
  recheckError: string | null;
  /** Informe ya comprobado de nuevo y guardado. */
  report: AuditReport | null;
  needSudo: boolean;
}

export interface AuditFixRequest {
  sessionId: string;
  profileId: string;
  serverName: string;
  elevation: Elevation;
  report: AuditReport;
  checks: Check[];
  /** Botones al terminar (p. ej. pedir la contraseña de sudo). */
  actions?: (data: AuditFixData) => JobAction[];
}

const EMPTY: AuditFixData = { results: {}, outcomes: {}, recheckError: null, report: null, needSudo: false };

async function applyAll(ctx: JobCtx, req: AuditFixRequest, data: AuditFixData): Promise<Check[]> {
  const ran: Check[] = [];
  const run = useAuditRun.getState();
  try {
    for (const [i, check] of req.checks.entries()) {
      if (ctx.canceled) break;
      const step = `Arreglando: ${check.title}…`;
      run.set(req.sessionId, step);
      ctx.phase(step, req.checks.length > 1 ? { done: i, total: req.checks.length } : null);
      ctx.output(`── ${check.title}\n`);
      const r = await runFix(ctx, { ...req, check });
      data.results = { ...data.results, [check.id]: r };
      data.needSudo = r.needSudo;
      ctx.setData({ ...data });
      ran.push(check);
      if (r.needSudo || r.canceled) break;
    }
  } finally {
    run.set(req.sessionId, null);
  }
  return ran;
}

async function runAuditFix(ctx: JobCtx, req: AuditFixRequest): Promise<JobResult> {
  const data: AuditFixData = { ...EMPTY };
  const ran = await applyAll(ctx, req, data);
  const failed = Object.values(data.results).filter((r) => !r.ok && !r.canceled);
  const end = (summary: string | null): JobResult => ({
    status: failed.length ? "failed" : "done",
    error: failed.length ? `${failed.length === 1 ? "Un arreglo falló" : `${failed.length} arreglos fallaron`}: mira su salida.` : null,
    summary,
    data: { ...data },
    actions: req.actions?.(data) ?? [],
  });
  if (!ran.length || ctx.canceled) return end(null);
  if (ran.some((c) => NO_RECHECK.has(c.id))) {
    data.recheckError = "El servidor se reinicia: vuelve a auditar cuando arranque.";
    return end(data.recheckError);
  }
  ctx.phase("Volviendo a comprobar lo arreglado…", null);
  try {
    const re = await recheckAudit({ sessionId: req.sessionId, profileId: req.profileId, elevation: req.elevation, report: req.report, fixed: ran, onStep: (t) => ctx.phase(t) });
    data.report = re.report;
    data.outcomes = Object.fromEntries(re.outcomes.map((o) => [o.id, o]));
    return end(fixSummary(re.outcomes, re.report));
  } catch (e) {
    data.recheckError = `No se pudo volver a comprobar: ${errorMessage(e)}`;
    return end(data.recheckError);
  }
}

/** Empieza los arreglos y devuelve el id de la tarea. */
export function startAuditFix(req: AuditFixRequest): string {
  const n = req.checks.length;
  return startJob({
    kind: AUDITFIX_JOB,
    sessionId: req.sessionId,
    server: req.serverName,
    title: n === 1 ? "Arreglar (auditoría)" : `Arreglar ${n} problemas (auditoría)`,
    detail: req.checks.map((c) => c.title).join(" · "),
    pane: "admin",
    data: EMPTY,
    run: (ctx) => runAuditFix(ctx, req),
  });
}

/** Datos de una tarea de arreglos de la auditoría (vacíos si es de otra cosa). */
export function auditFixData(job: Job | null | undefined): AuditFixData {
  return job?.kind === AUDITFIX_JOB ? (job.data as AuditFixData) : EMPTY;
}
