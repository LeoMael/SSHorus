// Cómo queda en el historial lo que se hace desde la Biblioteca, «Ejecutar en varios servidores» y las
// tareas en segundo plano. Lógica pura; quien guarda es record.ts (el motor tapa los secretos).
import type { ExecResult } from "../../api/types";
import type { NewHistoryEvent } from "../../api/serverHistory";
import { STATUS_TEXT, type Job } from "../../stores/jobsState";

/** Lo que se manda al motor como resultado, como mucho (el motor recorta otra vez). */
export const RESULT_MAX = 2000;

/** Lo último de `text` (lo que suele importar de una salida larga). */
export function tail(text: string, max = RESULT_MAX): string {
  const t = text.trimEnd();
  return t.length > max ? `…${t.slice(t.length - max)}` : t;
}

/** Código de salida y lo último de la salida de un comando. */
export function execResultText(r: ExecResult): string {
  const head = r.timedOut ? "Se agotó el tiempo" : `Código de salida ${r.exitCode ?? "desconocido"}`;
  const out = [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join("\n");
  return out ? `${head}\n${tail(out, RESULT_MAX - head.length - 1)}` : head;
}

export const execOk = (r: ExecResult) => !r.timedOut && r.exitCode === 0;

/** Primera línea de un comando (de título si no tiene nombre). */
export function firstLine(command: string): string {
  const l = command.trim().split("\n")[0] ?? "";
  return command.trim().includes("\n") ? `${l} …` : l;
}

export type LibraryOutcome = { kind: "result"; result: ExecResult } | { kind: "error"; message: string } | { kind: "terminal" };

/** Un comando de la Biblioteca: ejecutado aparte (con resultado o error) o escrito y ejecutado en la terminal. */
export function libraryEvent(name: string, command: string, outcome: LibraryOutcome, serverName: string): NewHistoryEvent {
  const base = { source: "library" as const, title: name || firstLine(command), detail: command, serverName };
  switch (outcome.kind) {
    case "result":
      return { ...base, ok: execOk(outcome.result), result: execResultText(outcome.result) };
    case "error":
      return { ...base, ok: false, result: tail(outcome.message) };
    case "terminal":
      return { ...base, ok: null, result: "Ejecutado en la terminal" };
  }
}

/** Tareas que ya dejan su rastro en otro registro (Administración o el historial de auditorías). */
export const JOBS_LOGGED_ELSEWHERE: ReadonlySet<string> = new Set([
  "weblog", // features/admin/webLogJob.ts → historial de Administración
  "auditfix", // features/audit/fixRun.ts → historial de Administración
  "serverconfig", // features/serverConfig/changeJob.ts → historial de Administración
  "scheduledaudit", // auditoría programada → informe guardado
  "projectaudit", // «Auditar proyecto» → informe guardado
]);

const JOB_LINES = 15;

/** Una tarea terminada, o null si no hace falta guardarla aquí. */
export function jobEvent(job: Job): NewHistoryEvent | null {
  if (job.status === "running" || JOBS_LOGGED_ELSEWHERE.has(job.kind)) return null;
  const lines = job.lines.slice(-JOB_LINES).join("\n");
  const result = [STATUS_TEXT[job.status], job.summary, job.error, lines].filter(Boolean).join("\n");
  return {
    source: "job",
    title: job.detail ? `${job.title} · ${job.detail}` : job.title,
    detail: job.detail,
    ok: job.status === "done",
    result: tail(result),
    serverName: job.server,
  };
}
