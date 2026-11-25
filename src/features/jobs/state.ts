// Tareas en segundo plano: tipos y transiciones de la lista (añadir, cambiar, terminar, quitar), texto
// de estado y aviso cuando una tarea lleva rato sin escribir nada. Funciones puras (sin React ni Tauri).
import type { ComponentType } from "react";

export type JobStatus = "running" | "done" | "failed" | "canceled";
export type StepState = "todo" | "current" | "done" | "error";

export interface JobStep {
  label: string;
  state: StepState;
}

/** Botón propio de una tarea («Ver y arreglar», «Reconectar»…). */
export interface JobAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

/** Panel de la pestaña del servidor donde vive lo que lanzó la tarea (para ir allí). */
export type JobPane = "containers" | "admin";

export interface JobProgress {
  done: number;
  total: number;
}

export interface Job {
  id: string;
  /** Tipo («compose», «vulnfix», «auditfix», «imageupdate», «reboot»…). */
  kind: string;
  /** Conexión donde corre (null = ninguna en concreto). */
  sessionId: string | null;
  /** Nombre del servidor, para la lista. */
  server: string;
  title: string;
  /** Proyecto, paquetes, imagen…: lo que distingue a esta tarea de otras iguales. */
  detail: string;
  /** Agrupa tareas de lo mismo (p. ej. un proyecto Compose). */
  key: string | null;
  pane: JobPane | null;
  status: JobStatus;
  /** Se pidió cancelar y aún no terminó. */
  stopping: boolean;
  /** Texto del botón de cancelar (null = no se puede cancelar). */
  cancelLabel: string | null;
  startedAt: number;
  endedAt: number | null;
  lastOutputAt: number;
  /** Fase en curso («Volviendo a comprobar…»). */
  phase: string | null;
  phaseAt: number;
  progress: JobProgress | null;
  steps: JobStep[];
  /** Salida ya limpia (las líneas de progreso repetidas, juntas). */
  lines: string[];
  /** Líneas viejas que ya no se guardan. */
  dropped: number;
  /** Avisar si deja de escribir (las que no tienen salida, como un reinicio, no). */
  watchOutput: boolean;
  error: string | null;
  /** Resultado en una frase. */
  summary: string | null;
  actions: JobAction[];
  /** Datos propios de quien la lanzó (los lee su `view`). */
  data: unknown;
  /** Parte propia del resultado en la vista grande (p. ej. los servicios que reiniciar). */
  view: ComponentType<{ job: Job }> | null;
}

/** Tareas terminadas que se recuerdan (las que están en marcha, todas). */
export const MAX_FINISHED = 20;
/** Segundos sin salida nueva a partir de los que se avisa. */
export const STALL_SECS = 60;

export const STATUS_TEXT: Record<JobStatus, string> = {
  running: "En marcha",
  done: "Terminada",
  failed: "Falló",
  canceled: "Cancelada",
};

export type JobPatch = Partial<Omit<Job, "id">>;

/** Lo que describe quien lanza la tarea (el resto empieza vacío). */
export interface JobInit {
  kind: string;
  sessionId: string | null;
  server: string;
  title: string;
  detail?: string;
  key?: string | null;
  pane?: JobPane | null;
  /** Por defecto «Cancelar»; null = no se puede cancelar. */
  cancelLabel?: string | null;
  /** Pasos que se enseñan (empieza en el primero). */
  steps?: readonly string[];
  watchOutput?: boolean;
  phase?: string | null;
  data?: unknown;
  view?: Job["view"];
}

export function newJob(id: string, init: JobInit, now: number): Job {
  return {
    id,
    kind: init.kind,
    sessionId: init.sessionId,
    server: init.server,
    title: init.title,
    detail: init.detail ?? "",
    key: init.key ?? null,
    pane: init.pane ?? null,
    status: "running",
    stopping: false,
    cancelLabel: init.cancelLabel === undefined ? "Cancelar" : init.cancelLabel,
    startedAt: now,
    endedAt: null,
    lastOutputAt: now,
    phase: init.phase ?? null,
    phaseAt: now,
    progress: null,
    steps: init.steps ? stepsAt(init.steps, 0) : [],
    lines: [],
    dropped: 0,
    watchOutput: init.watchOutput ?? true,
    error: null,
    summary: null,
    actions: [],
    data: init.data,
    view: init.view ?? null,
  };
}

/** Añade una tarea arriba del todo; de las terminadas se quedan solo las `MAX_FINISHED` más nuevas. */
export function addJob(jobs: Job[], job: Job): Job[] {
  const rest = jobs.filter((j) => j.id !== job.id);
  const running = rest.filter((j) => j.status === "running");
  const finished = rest.filter((j) => j.status !== "running");
  const keep = job.status === "running" ? MAX_FINISHED : MAX_FINISHED - 1;
  return [job, ...running, ...finished.slice(0, keep)];
}

export function patchJob(jobs: Job[], id: string, p: JobPatch): Job[] {
  let changed = false;
  const next = jobs.map((j) => {
    if (j.id !== id) return j;
    changed = true;
    return { ...j, ...p };
  });
  return changed ? next : jobs;
}

export interface JobEnd {
  status: Exclude<JobStatus, "running">;
  error?: string | null;
  summary?: string | null;
  actions?: JobAction[];
  data?: unknown;
}

/** La tarea terminada: el paso en curso queda hecho (o con error si falló). */
export function finishedJob(job: Job, end: JobEnd, now: number): Job {
  const stepEnd: StepState = end.status === "done" ? "done" : "error";
  return {
    ...job,
    status: end.status,
    stopping: false,
    endedAt: now,
    phase: null,
    error: end.status === "failed" ? (end.error ?? "Falló") : (end.error ?? null),
    summary: end.summary ?? null,
    actions: end.actions ?? job.actions,
    data: end.data === undefined ? job.data : end.data,
    steps: job.steps.map((s) => (s.state === "current" ? { ...s, state: stepEnd } : s)),
  };
}

/** Quita una tarea terminada (las que están en marcha no se quitan). */
export function dismissJob(jobs: Job[], id: string): Job[] {
  return jobs.filter((j) => j.id !== id || j.status === "running");
}

export function clearFinished(jobs: Job[]): Job[] {
  return jobs.filter((j) => j.status === "running");
}

/** Qué tareas enseña el centro (p. ej. solo las de un proyecto Compose). */
export interface JobFilter {
  label: string;
  kind?: string;
  sessionId?: string;
  key?: string;
}

export function matchesFilter(job: Job, f: JobFilter | null): boolean {
  if (!f) return true;
  return (f.kind === undefined || job.kind === f.kind) && (f.sessionId === undefined || job.sessionId === f.sessionId) && (f.key === undefined || job.key === f.key);
}

export function jobCounts(jobs: Job[]): { running: number; failed: number; finished: number } {
  let running = 0;
  let failed = 0;
  for (const j of jobs) {
    if (j.status === "running") running++;
    else if (j.status === "failed") failed++;
  }
  return { running, failed, finished: jobs.length - running };
}

/** «2 tareas», «1 tarea». */
export function countText(n: number): string {
  return `${n} ${n === 1 ? "tarea" : "tareas"}`;
}

/** Última línea de salida que dice algo (no solo rayas o puntos). */
export function lastMeaningfulLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (/[\p{L}\p{N}]/u.test(t)) return t.length > 140 ? `${t.slice(0, 139)}…` : t;
  }
  return null;
}

/** Una línea corta de en qué va: la fase o la última salida (la que sea más nueva); al terminar, el resultado. */
export function statusLine(job: Job): string {
  if (job.status !== "running") return job.summary ?? job.error?.split("\n")[0] ?? STATUS_TEXT[job.status];
  if (job.stopping) return "Deteniendo…";
  const line = lastMeaningfulLine(job.lines);
  if (job.phase && (!line || job.phaseAt >= job.lastOutputAt)) return job.phase;
  return line ?? job.phase ?? "Empezando…";
}

/** Aviso cuando una tarea lleva un rato sin escribir nada (null = todo normal). */
export function stallText(idleSecs: number): string | null {
  if (idleSecs < STALL_SECS) return null;
  const min = Math.floor(idleSecs / 60);
  return `Sin salida nueva desde hace ${min} min — puede seguir trabajando (descargando, instalando) o estar atascada`;
}

/** El aviso de `stallText` para esta tarea, si toca. */
export function jobStall(job: Job, now: number): string | null {
  if (job.status !== "running" || job.stopping || !job.watchOutput) return null;
  return stallText((now - job.lastOutputAt) / 1000);
}

/** «0:42», «12:05», «1:02:09». */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Tiempo que lleva (o que tardó). */
export function elapsedText(job: Job, now: number): string {
  return formatClock((job.endedAt ?? now) - job.startedAt);
}

/** Pasos con el número `i` en curso, los anteriores hechos y los siguientes por hacer. */
export function stepsAt(labels: readonly string[], i: number): JobStep[] {
  return labels.map((label, j) => ({ label, state: j < i ? "done" : j === i ? "current" : "todo" }));
}
