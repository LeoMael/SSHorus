// Guardar en el historial de un servidor. Nunca molesta a quien lo llama: si falla, solo se anota en la
// consola. El motor tapa contraseñas y llaves antes de escribir.
import { create } from "zustand";
import { serverHistory, type NewHistoryEvent } from "../../api/serverHistory";
import { useTabs } from "../../stores/tabs";
import { onJobFinished } from "../jobs";
import { jobEvent } from "./events";

/** Sube cada vez que se guarda algo (el historial abierto se vuelve a leer). */
export const useHistorySeq = create<{ seq: number }>(() => ({ seq: 0 }));

export function recordEvent(serverId: string, ev: NewHistoryEvent): void {
  serverHistory
    .append(serverId, ev)
    .then(() => useHistorySeq.setState((s) => ({ seq: s.seq + 1 })))
    .catch((e: unknown) => console.warn("No se pudo guardar en el historial del servidor", e));
}

/** Servidor (id y nombre de la pestaña) de una conexión abierta. */
export function serverOfSession(sessionId: string | null): { id: string; name: string } | null {
  const t = sessionId ? useTabs.getState().tabs.find((x) => x.sessionId === sessionId) : undefined;
  return t ? { id: t.profileId, name: t.title } : null;
}

/** Como `recordEvent`, a partir de la conexión (si la pestaña ya no existe, no se guarda). */
export function recordForSession(sessionId: string | null, make: (serverName: string) => NewHistoryEvent): void {
  const srv = serverOfSession(sessionId);
  if (srv) recordEvent(srv.id, make(srv.name));
}

let started = false;

/** Guarda las tareas en segundo plano al terminar (una vez, desde App). */
export function initServerHistory(): void {
  if (started) return;
  started = true;
  onJobFinished((job) => {
    const ev = jobEvent(job);
    if (ev) recordForSession(job.sessionId, (name) => ({ ...ev, serverName: ev.serverName || name }));
  });
}
