// Tareas en segundo plano de toda la app (Compose, arreglar vulnerabilidades, auditoría, actualizar una
// imagen, reinicios…): la lista, la ventanita de la esquina, la vista grande y los avisos al terminar.
// Las transiciones puras están en features/jobs/state.ts y quien ejecuta las tareas, en features/jobs/run.ts.
import { create } from "zustand";
import { addJob, clearFinished, dismissJob, patchJob, type Job, type JobFilter, type JobPatch } from "../features/jobs/state";

interface JobsState {
  jobs: Job[];
  /** Ventanita de la esquina abierta. */
  popover: boolean;
  /** Vista grande abierta. */
  center: boolean;
  /** Tarea elegida en la vista grande. */
  selected: string | null;
  filter: JobFilter | null;
  /** Tareas recién terminadas con su aviso en la esquina. */
  notices: string[];
}

export const useJobs = create<JobsState>(() => ({ jobs: [], popover: false, center: false, selected: null, filter: null, notices: [] }));

const set = useJobs.setState;

export function putJob(job: Job): void {
  set((s) => ({ jobs: addJob(s.jobs, job) }));
}

export function updateJob(id: string, p: JobPatch): void {
  set((s) => {
    const jobs = patchJob(s.jobs, id, p);
    return jobs === s.jobs ? s : { jobs };
  });
}

export function getJob(id: string): Job | undefined {
  return useJobs.getState().jobs.find((j) => j.id === id);
}

/** Quita de la lista una tarea terminada. */
export function removeJob(id: string): void {
  set((s) => ({ jobs: dismissJob(s.jobs, id), notices: s.notices.filter((n) => n !== id), selected: s.selected === id ? null : s.selected }));
}

/** Vacía el historial (las que están en marcha siguen). */
export function clearJobHistory(): void {
  set((s) => {
    const jobs = clearFinished(s.jobs);
    const alive = new Set(jobs.map((j) => j.id));
    return { jobs, notices: [], selected: s.selected && alive.has(s.selected) ? s.selected : null };
  });
}

/** Abre la vista grande (en esa tarea y/o con ese filtro). */
export function openJobCenter(o: { jobId?: string; filter?: JobFilter | null } = {}): void {
  set((s) => ({
    center: true,
    popover: false,
    selected: o.jobId ?? s.selected,
    filter: o.filter === undefined ? (o.jobId ? null : s.filter) : o.filter,
    notices: o.jobId ? s.notices.filter((n) => n !== o.jobId) : s.notices,
  }));
}

export function closeJobCenter(): void {
  set({ center: false });
}

export function selectJob(id: string | null): void {
  set({ selected: id });
}

export function setJobFilter(filter: JobFilter | null): void {
  set({ filter });
}

export function setJobsPopover(open: boolean): void {
  set((s) => ({ popover: open, notices: open ? [] : s.notices }));
}

/** Aviso «terminó» en la esquina (no hace falta si ya se está mirando esa tarea). */
export function pushJobNotice(id: string): void {
  set((s) => (s.popover || (s.center && s.selected === id) ? s : { notices: [...s.notices.filter((n) => n !== id), id].slice(-3) }));
}

export function dropJobNotice(id: string): void {
  set((s) => ({ notices: s.notices.filter((n) => n !== id) }));
}
