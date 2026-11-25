// Ejecutar tareas en segundo plano: siguen aunque se cierre el diálogo que las lanzó o se cambie de
// pestaña, con su salida en vivo, fases, «Cancelar» y un aviso al terminar. Quien lanza la tarea solo
// describe qué hacer (`run`); aquí se lleva el estado (store `useJobs`).
import { errorMessage } from "../../api/core";
import { newExecId } from "../../api/snippets";
import { getJob, pushJobNotice, putJob, setJobsPopover, updateJob } from "../../stores/jobs";
import { useTabs } from "../../stores/tabs";
import { JobOutput, type OutputRules } from "./output";
import { finishedJob, newJob, stepsAt, type Job, type JobEnd, type JobInit, type JobPatch, type JobProgress } from "./state";

/** Se lanza (o se devuelve) cuando la tarea se canceló. */
export class JobCanceled extends Error {
  constructor() {
    super("Cancelado");
  }
}

/** Lo que una tarea puede hacer mientras corre. */
export interface JobCtx {
  readonly id: string;
  readonly canceled: boolean;
  /** Salida tal y como llega (se limpia y se junta). */
  output: (text: string) => void;
  /** Fase en curso; con `progress`, también cuánto lleva. */
  phase: (text: string, progress?: JobProgress | null) => void;
  progress: (p: JobProgress | null) => void;
  /** Pasa al paso número `i` de `steps` (los anteriores quedan hechos). */
  step: (i: number) => void;
  /** Cambia los datos propios (los ve su `view` y quien siga la tarea). */
  setData: (data: unknown) => void;
  /** Qué hacer al pulsar «Cancelar» (p. ej. matar el proceso en el servidor). Devuelve la baja. */
  onCancel: (fn: () => Promise<unknown> | void) => () => void;
  /** Lanza `JobCanceled` si ya se pidió cancelar. */
  check: () => void;
}

export type JobResult = Partial<Omit<JobEnd, "status">> & { status?: "done" | "failed" };

export interface JobSpec extends Omit<JobInit, "server"> {
  server?: string;
  /** Limpieza de la salida (líneas de progreso que se juntan, ruido). */
  output?: OutputRules;
  /** Abre la ventanita de la esquina al empezar (cuando se cierra el diálogo que la lanzó). */
  reveal?: boolean;
  run: (ctx: JobCtx) => Promise<JobResult | void>;
  /** Al terminar (bien, mal o cancelada), con la tarea ya actualizada. */
  onFinished?: (job: Job) => void;
}

interface Control {
  canceled: boolean;
  cancellers: Set<() => Promise<unknown> | void>;
}

const controls = new Map<string, Control>();
const finishedListeners = new Set<(job: Job) => void>();

/** Avisa al terminar cualquier tarea. Devuelve la baja. */
export function onJobFinished(cb: (job: Job) => void): () => void {
  finishedListeners.add(cb);
  return () => {
    finishedListeners.delete(cb);
  };
}

function serverName(sessionId: string | null): string {
  return (sessionId && useTabs.getState().tabs.find((t) => t.sessionId === sessionId)?.title) || "";
}

function begin(spec: Omit<JobSpec, "run">): { id: string; ctl: Control } {
  const id = newExecId();
  putJob(newJob(id, { ...spec, server: spec.server ?? serverName(spec.sessionId) }, Date.now()));
  const ctl: Control = { canceled: false, cancellers: new Set() };
  controls.set(id, ctl);
  if (spec.reveal) setJobsPopover(true);
  return { id, ctl };
}

function end(id: string, result: JobEnd, extra: JobPatch, onFinished?: (job: Job) => void) {
  controls.delete(id);
  const job = getJob(id);
  if (!job) return;
  const done = finishedJob({ ...job, ...extra }, result, Date.now());
  updateJob(id, done);
  pushJobNotice(id);
  onFinished?.(done);
  for (const cb of finishedListeners) cb(done);
}

/** Empieza la tarea y devuelve su id. */
export function startJob(spec: JobSpec): string {
  const { id, ctl } = begin(spec);
  void execute(id, ctl, spec);
  return id;
}

async function execute(id: string, ctl: Control, spec: JobSpec) {
  const out = new JobOutput(spec.output);
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    updateJob(id, { lines: out.view(), dropped: out.dropped, lastOutputAt: last });
  };
  const labels = spec.steps ?? [];
  const ctx: JobCtx = {
    id,
    get canceled() {
      return ctl.canceled;
    },
    output: (t) => {
      out.push(t);
      last = Date.now();
      timer ??= setTimeout(flush, 250);
    },
    phase: (text, progress) => updateJob(id, { phase: text, phaseAt: Date.now(), ...(progress !== undefined ? { progress } : {}) }),
    progress: (progress) => updateJob(id, { progress }),
    step: (i) => updateJob(id, { steps: stepsAt(labels, i) }),
    setData: (data) => updateJob(id, { data }),
    onCancel: (fn) => {
      ctl.cancellers.add(fn);
      return () => {
        ctl.cancellers.delete(fn);
      };
    },
    check: () => {
      if (ctl.canceled) throw new JobCanceled();
    },
  };

  let result: JobEnd;
  try {
    const r = (await spec.run(ctx)) ?? {};
    result = { ...r, status: ctl.canceled ? "canceled" : (r.status ?? "done") };
  } catch (e) {
    result = ctl.canceled || e instanceof JobCanceled ? { status: "canceled" } : { status: "failed", error: errorMessage(e) };
  }
  if (timer) clearTimeout(timer);
  out.end();
  end(id, result, { lines: out.view(), dropped: out.dropped, lastOutputAt: last }, spec.onFinished);
}

/** «Cancelar»: ejecuta lo que la tarea pidió (matar el proceso en el servidor, cortar el canal…). */
export async function cancelJob(id: string): Promise<void> {
  const ctl = controls.get(id);
  if (!ctl || ctl.canceled) return;
  ctl.canceled = true;
  updateJob(id, { stopping: true });
  await Promise.allSettled([...ctl.cancellers].map(async (fn) => fn()));
}

/** Tarea que avanza por fuera (p. ej. un reinicio, que sigue a las pestañas): quien la lleva la actualiza. */
export interface TrackedJob {
  id: string;
  update: (p: JobPatch) => void;
  finish: (r: JobEnd) => void;
  /** Vuelve a ponerla en marcha (p. ej. tras reconectar a mano). */
  resume: (p?: JobPatch) => void;
}

export function trackJob(spec: Omit<JobSpec, "run" | "output" | "onFinished">, onCancel?: () => Promise<unknown> | void): TrackedJob {
  const { id, ctl } = begin(spec);
  const arm = (c: Control) => {
    if (onCancel) c.cancellers.add(onCancel);
  };
  arm(ctl);
  return {
    id,
    update: (p) => updateJob(id, p),
    finish: (r) => {
      if (controls.has(id)) end(id, controls.get(id)?.canceled ? { ...r, status: "canceled" } : r, {});
    },
    resume: (p = {}) => {
      if (controls.has(id) || !getJob(id)) return;
      const c: Control = { canceled: false, cancellers: new Set() };
      arm(c);
      controls.set(id, c);
      updateJob(id, { ...p, status: "running", stopping: false, endedAt: null, error: null, summary: null });
    },
  };
}
