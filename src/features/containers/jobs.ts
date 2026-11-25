// Tareas largas de Contenedores (Compose up/pull/build, «Aplicar cambios», descargar una imagen) como
// tareas en segundo plano de la app (features/jobs): cada grupo de comandos va como su dueño y
// «Cancelar» detiene su grupo de procesos también como ese dueño (la señal del canal no le llega).
import { runKillable, startJob, type Job, type JobAction, type JobCtx, type JobResult } from "../jobs";
import { COMPOSE_OUTPUT } from "./composeOutput";
import { parseNameConflicts, type NameConflict } from "./nameConflict";
import { groupByOwner } from "./owner";
import { ownerWrap, type OwnerRunner } from "./ownerRun";
import { runRaw, scriptFor, type EngineRun } from "./run";
import type { Cmd } from "./shell";

export const CT_JOB_KIND = "compose";

/** Lo que hace falta para repetir la tarea (p. ej. tras quitar el contenedor que choca). */
export interface CtJobData {
  /** Dueño de los comandos (clave de `owner.ts`). */
  owner: string;
  cmds: Cmd[];
  /** Aviso al terminar bien (también al volver a intentarla). */
  success: string;
  /** Comando que imprime el compose completo (para ver qué nombres fijos usa). */
  configCmd?: Cmd;
  /** Contenedores que ya tenían el nombre que hacía falta («Ya existe un contenedor con ese nombre»). */
  conflicts: NameConflict[];
  needSudo: boolean;
}

export interface CtJob {
  id: string;
  title: string;
  detail: string;
  key: string;
  status: Job["status"];
  data: CtJobData;
}

/** La tarea de Contenedores (o null si es de otra cosa). */
export function ctJob(job: Job): CtJob | null {
  if (job.kind !== CT_JOB_KIND) return null;
  return { id: job.id, title: job.title, detail: job.detail, key: job.key ?? "", status: job.status, data: job.data as CtJobData };
}

export interface JobRequest {
  title: string;
  detail: string;
  /** Quién la lanzó (p. ej. la clave del proyecto Compose), para mostrarla allí. */
  key: string;
  owner: string;
  cmds: Cmd[];
  success: string;
  configCmd?: Cmd;
  timeoutSecs?: number;
  /** Botones propios al terminar (arreglar el nombre repetido, sudo…). */
  actions?: (job: CtJob) => JobAction[];
  onFinished?: (job: CtJob) => void;
}

/** Una hora: lo que más puede tardar un `up --build` razonable. */
const JOB_TIMEOUT_SECS = 3600;

interface Outcome {
  ok: boolean;
  error: string | null;
  needSudo: boolean;
  /** Toda la salida (para buscar el nombre que choca). */
  text: string;
}

async function runGroups(ctx: JobCtx, runner: OwnerRunner, req: JobRequest): Promise<Outcome> {
  let text = "";
  for (const g of groupByOwner(req.cmds, runner.fallback)) {
    ctx.check();
    const o = runner.resolve(g.owner);
    if (!o) return { ok: false, error: "No se encontró el usuario dueño de esto. Vuelve a buscar los usuarios (botón de recargar).", needSudo: false, text };
    const el = runner.elevationFor(o);
    if (!el) return { ok: false, error: "Hace falta sudo", needSudo: true, text };
    const r = await runKillable<EngineRun>(ctx, scriptFor(g.cmds), req.timeoutSecs ?? JOB_TIMEOUT_SECS, {
      wrap: (s) => ownerWrap(runner.engine, o, s),
      exec: (s, run) => runRaw(runner.sessionId, s, el, run?.timeoutSecs ?? 30, run ? { execId: run.execId, onOutput: ctx.output } : undefined),
      timedOut: (x) => x.result?.timedOut ?? false,
      stdout: (x) => x.result?.stdout ?? "",
    });
    text += `${r.result?.stdout ?? ""}\n${r.result?.stderr ?? ""}\n`;
    if (!r.ok) return { ok: false, error: r.error, needSudo: r.needSudo, text };
  }
  return { ok: true, error: null, needSudo: false, text };
}

function conflictText(conflicts: NameConflict[]): string {
  return `Ya existe un contenedor llamado «${conflicts.map((c) => c.name).join("», «")}» que esta herramienta no reconoce como suyo (lo creó otra herramienta, como podman-compose, o se hizo a mano).`;
}

/** Empieza la tarea y devuelve su id. */
export function startCtJob(runner: OwnerRunner, req: JobRequest): string {
  const base: CtJobData = { owner: req.owner, cmds: req.cmds, success: req.success, configCmd: req.configCmd, conflicts: [], needSudo: false };
  return startJob({
    kind: CT_JOB_KIND,
    sessionId: runner.sessionId,
    title: req.title,
    detail: req.detail,
    key: req.key,
    pane: "containers",
    data: base,
    output: COMPOSE_OUTPUT,
    run: async (ctx): Promise<JobResult> => {
      const res = await runGroups(ctx, runner, req);
      if (res.ok) return { summary: req.success };
      const conflicts = parseNameConflicts(res.text);
      const data: CtJobData = { ...base, conflicts, needSudo: res.needSudo };
      const job: CtJob = { id: ctx.id, title: req.title, detail: req.detail, key: req.key, status: "failed", data };
      return { status: "failed", error: conflicts.length ? conflictText(conflicts) : res.error, data, actions: req.actions?.(job) ?? [] };
    },
    onFinished: (j) => {
      const c = ctJob(j);
      if (c) req.onFinished?.(c);
    },
  });
}
