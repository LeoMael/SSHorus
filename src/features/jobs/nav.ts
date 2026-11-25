// «Ir allí» desde una tarea: muestra la pestaña del servidor y el panel donde se lanzó (Contenedores,
// Administración), por ejemplo para abrir el diálogo de un botón de la tarea.
import { create } from "zustand";
import { useTabs } from "../../stores/tabs";
import type { Job, JobPane } from "./state";

export interface JobNavRequest {
  sessionId: string;
  pane: JobPane;
  seq: number;
}

let seq = 0;

export const useJobNav = create<{ request: JobNavRequest | null }>(() => ({ request: null }));

/** Lleva a la pestaña (y al panel) de la tarea. false si su conexión ya no está abierta. */
export function goToJob(job: Pick<Job, "sessionId" | "pane">): boolean {
  const tab = job.sessionId ? useTabs.getState().tabs.find((t) => t.sessionId === job.sessionId) : undefined;
  if (!tab) return false;
  useTabs.getState().setActive(tab.id);
  if (job.pane) useJobNav.setState({ request: { sessionId: tab.sessionId, pane: job.pane, seq: ++seq } });
  return true;
}
