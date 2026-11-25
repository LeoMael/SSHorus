// «Reiniciar ahora» como tarea en segundo plano: sus pasos (reiniciando, esperando a que vuelva,
// conectado de nuevo), en qué va, «Dejar de esperar» y el resultado. Lo que enseña sale de cada estado
// del reinicio (`rebootJobView`, puro); store.ts lo aplica cada vez que cambia.
import { getJob, removeJob } from "../../stores/jobs";
import { trackJob, type JobAction, type JobEnd, type JobPatch, type TrackedJob } from "../jobs";
import { isActive, phaseDetail, phaseTitle, STEPS, stepStates, type RebootRun } from "./progress";

export const REBOOT_JOB_KIND = "reboot";

/** Lo que enseña la tarea ahora y, si el reinicio acabó, cómo terminó. */
export function rebootJobView(run: RebootRun): { patch: JobPatch; end: JobEnd | null } {
  const states = stepStates(run);
  const patch: JobPatch = {
    sessionId: run.sessionId,
    steps: STEPS.map((label, i) => ({ label, state: states[i] })),
    phase: `${phaseTitle(run)} ${phaseDetail(run)}`,
    phaseAt: Date.now(),
  };
  if (isActive(run.phase)) return { patch, end: null };
  const detail = phaseDetail(run);
  if (run.phase === "done") return { patch, end: { status: "done", summary: detail } };
  if (run.phase === "stopped") return { patch, end: { status: "canceled", summary: detail } };
  return { patch, end: { status: "failed", error: detail } };
}

/** Tarea de cada reinicio (por servidor y por cuándo empezó). */
const tracked = new Map<string, { startedAt: number; job: TrackedJob }>();

/**
 * Pone la tarea al día con el reinicio. `stop`: «Dejar de esperar»; `actions`: botones al terminar
 * (p. ej. «Reconectar» si se cerró la conexión).
 */
export function syncRebootJob(run: RebootRun, stop: () => void, actions: (run: RebootRun) => JobAction[]): void {
  let t = tracked.get(run.key);
  if (!t || t.startedAt !== run.startedAt) {
    const job = trackJob(
      {
        kind: REBOOT_JOB_KIND,
        sessionId: run.sessionId,
        server: run.serverName,
        title: "Reiniciar el servidor",
        steps: STEPS,
        watchOutput: false,
        cancelLabel: "Dejar de esperar",
        reveal: true,
      },
      stop,
    );
    t = { startedAt: run.startedAt, job };
    tracked.set(run.key, t);
  }
  const { patch, end } = rebootJobView(run);
  const running = getJob(t.job.id)?.status === "running";
  if (!end) {
    if (running) t.job.update(patch);
    else t.job.resume(patch);
  } else if (running) {
    t.job.update(patch);
    t.job.finish({ ...end, actions: actions(run) });
  }
}

/** Quita la tarea (el reinicio no llegó a empezar, p. ej. sin contraseña de sudo). */
export function dropRebootJob(key: string): void {
  const t = tracked.get(key);
  if (!t) return;
  tracked.delete(key);
  removeJob(t.job.id);
}
