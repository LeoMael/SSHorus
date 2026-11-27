// «Auditar proyecto»: qué proyecto enseña el diálogo, cómo va cada servidor (por id de servidor guardado) y la
// tarea en marcha de cada proyecto. Lo actualiza la tarea (projectAuditJob.ts); lo lee el diálogo.
import { create } from "zustand";
import { IDLE_ROW, type ServerAuditRow } from "./projectAudit";

interface ProjectAuditState {
  /** Proyecto del diálogo abierto (null = cerrado). */
  open: string | null;
  rows: Record<string, ServerAuditRow>;
  /** Id de la tarea en marcha por proyecto. */
  jobs: Record<string, string>;
}

export const useProjectAudit = create<ProjectAuditState>(() => ({ open: null, rows: {}, jobs: {} }));

export function openProjectAudit(projectId: string): void {
  useProjectAudit.setState({ open: projectId });
}

export function closeProjectAudit(): void {
  useProjectAudit.setState({ open: null });
}

export function patchAuditRow(profileId: string, patch: Partial<ServerAuditRow>): void {
  useProjectAudit.setState((s) => ({ rows: { ...s.rows, [profileId]: { ...(s.rows[profileId] ?? IDLE_ROW), ...patch } } }));
}

export function setProjectJob(projectId: string, jobId: string | null): void {
  useProjectAudit.setState((s) => {
    const jobs = { ...s.jobs };
    if (jobId) jobs[projectId] = jobId;
    else delete jobs[projectId];
    return { jobs };
  });
}
