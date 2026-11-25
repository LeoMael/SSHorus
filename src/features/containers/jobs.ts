// Tareas largas de Contenedores en segundo plano (Compose up/pull/build, descargar una imagen): siguen
// aunque cierres el diálogo o cambies de pestaña, con su salida en vivo, «Cancelar» (que detiene el
// proceso también en el servidor, como su dueño) y un aviso al terminar.
import { create } from "zustand";
import { newExecId, snippets } from "../../api/snippets";
import { errorMessage } from "../../api/core";
import { toast } from "../../stores/toasts";
import type { Elevation } from "../privileges";
import { JobOutput } from "./jobOutput";
import { jobScript, killJobScript } from "./jobScript";
import { parseNameConflicts, type NameConflict } from "./nameConflict";
import { groupByOwner, type CtOwner } from "./owner";
import { ownerWrap, type OwnerRunner } from "./ownerRun";
import { runRaw, scriptFor } from "./run";
import type { Cmd } from "./shell";

export type JobStatus = "running" | "done" | "failed" | "canceled";

export interface CtJob {
  id: string;
  sessionId: string;
  title: string;
  /** Proyecto, imagen o usuario, para la lista. */
  detail: string;
  /** Quién la lanzó (p. ej. la clave del proyecto Compose), para mostrarla allí. */
  key: string;
  /** Dueño de los comandos (clave de `owner.ts`). */
  owner: string;
  cmds: Cmd[];
  /** Aviso al terminar bien (también al volver a intentarla). */
  success: string;
  /** Comando que imprime el compose completo (para ver qué nombres fijos usa). */
  configCmd?: Cmd;
  status: JobStatus;
  /** Se pidió cancelar y aún no terminó. */
  stopping: boolean;
  startedAt: number;
  lastOutputAt: number;
  endedAt: number | null;
  lines: string[];
  error: string | null;
  /** Contenedores que ya tenían el nombre que hacía falta («Ya existe un contenedor con ese nombre»). */
  conflicts: NameConflict[];
  needSudo: boolean;
}

export interface JobRequest {
  title: string;
  detail: string;
  key: string;
  owner: string;
  cmds: Cmd[];
  /** Aviso al terminar bien. */
  success: string;
  configCmd?: Cmd;
  timeoutSecs?: number;
  onFinished?: (job: CtJob) => void;
}

interface JobsState {
  jobs: CtJob[];
  /** Quita de la lista una tarea terminada. */
  dismiss: (id: string) => void;
}

export const useCtJobs = create<JobsState>((set) => ({
  jobs: [],
  dismiss: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id || j.status === "running") })),
}));

/** Tareas terminadas que se recuerdan (las en marcha, todas). */
const MAX_FINISHED = 15;
/** Una hora: lo que más puede tardar un `up --build` razonable. */
const JOB_TIMEOUT_SECS = 3600;

interface Control {
  runner: OwnerRunner;
  canceled: boolean;
  current: { execId: string; owner: CtOwner; el: Elevation } | null;
}
const controls = new Map<string, Control>();

function patch(id: string, p: Partial<CtJob>) {
  useCtJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
}

/** Empieza la tarea y devuelve su id. */
export function startJob(runner: OwnerRunner, req: JobRequest): string {
  const id = newExecId();
  const now = Date.now();
  const job: CtJob = {
    id,
    sessionId: runner.sessionId,
    title: req.title,
    detail: req.detail,
    key: req.key,
    owner: req.owner,
    cmds: req.cmds,
    success: req.success,
    configCmd: req.configCmd,
    status: "running",
    stopping: false,
    startedAt: now,
    lastOutputAt: now,
    endedAt: null,
    lines: [],
    error: null,
    conflicts: [],
    needSudo: false,
  };
  useCtJobs.setState((s) => {
    const finished = s.jobs.filter((j) => j.status !== "running").slice(0, MAX_FINISHED - 1);
    return { jobs: [job, ...s.jobs.filter((j) => j.status === "running"), ...finished] };
  });
  controls.set(id, { runner, canceled: false, current: null });
  void execute(id, req);
  return id;
}

interface Outcome {
  ok: boolean;
  error: string | null;
  needSudo: boolean;
  /** Toda la salida (para buscar el nombre que choca). */
  text: string;
}

async function runGroups(id: string, ctl: Control, req: JobRequest, onOutput: (t: string) => void): Promise<Outcome> {
  const { runner } = ctl;
  let text = "";
  for (const g of groupByOwner(req.cmds, runner.fallback)) {
    if (ctl.canceled) break;
    const o = runner.resolve(g.owner);
    if (!o) return { ok: false, error: "No se encontró el usuario dueño de esto. Vuelve a buscar los usuarios (botón de recargar).", needSudo: false, text };
    const el = runner.elevationFor(o);
    if (!el) return { ok: false, error: "Hace falta sudo", needSudo: true, text };
    const execId = newExecId();
    let script: string;
    try {
      script = await ownerWrap(runner.engine, o, jobScript(id, scriptFor(g.cmds)));
    } catch (e) {
      return { ok: false, error: errorMessage(e), needSudo: false, text };
    }
    if (ctl.canceled) break;
    ctl.current = { execId, owner: o, el };
    const r = await runRaw(runner.sessionId, script, el, req.timeoutSecs ?? JOB_TIMEOUT_SECS, { execId, onOutput });
    ctl.current = null;
    text += `${r.result?.stdout ?? ""}\n${r.result?.stderr ?? ""}\n`;
    if (!r.ok) return { ok: false, error: r.error, needSudo: r.needSudo, text };
  }
  return { ok: true, error: null, needSudo: false, text };
}

async function execute(id: string, req: JobRequest) {
  const ctl = controls.get(id);
  if (!ctl) return;
  const out = new JobOutput();
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    patch(id, { lines: out.view(), lastOutputAt: last });
  };
  const onOutput = (t: string) => {
    out.push(t);
    last = Date.now();
    timer ??= setTimeout(flush, 250);
  };

  const res = await runGroups(id, ctl, req, onOutput);
  if (timer) clearTimeout(timer);
  out.end();
  controls.delete(id);
  const lines = out.view();
  const status: JobStatus = ctl.canceled ? "canceled" : res.ok ? "done" : "failed";
  const conflicts = status === "failed" ? parseNameConflicts(`${res.text}\n${lines.join("\n")}`) : [];
  const done: Partial<CtJob> = { status, stopping: false, lines, lastOutputAt: last, endedAt: Date.now(), error: status === "failed" ? res.error : null, conflicts, needSudo: res.needSudo };
  patch(id, done);

  if (status === "done") toast.success(req.success, req.detail);
  else if (status === "canceled") toast.info("Tarea cancelada", `${req.title} · ${req.detail}`);
  else if (conflicts.length) toast.error(`${req.title}: falló`, `Ya existe un contenedor llamado «${conflicts[0].name}». Abre la tarea (Contenedores → Tareas) para arreglarlo.`);
  else toast.error(`${req.title}: falló`, res.error?.split("\n")[0] ?? undefined);
  const job = useCtJobs.getState().jobs.find((j) => j.id === id);
  if (job) req.onFinished?.(job);
}

/** Cancela: detiene el grupo de procesos como su dueño y luego corta el canal. */
export async function cancelJob(id: string): Promise<void> {
  const ctl = controls.get(id);
  if (!ctl || ctl.canceled) return;
  ctl.canceled = true;
  patch(id, { stopping: true });
  const cur = ctl.current;
  if (!cur) return;
  try {
    const kill = await ownerWrap(ctl.runner.engine, cur.owner, killJobScript(id));
    await runRaw(ctl.runner.sessionId, kill, cur.el, 30);
  } finally {
    await snippets.cancelExec(cur.execId).catch(() => false);
  }
}
