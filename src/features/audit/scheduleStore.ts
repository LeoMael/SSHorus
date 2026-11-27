// Auditoría programada: qué se repite y cómo fue (en este equipo, localStorage, como otras preferencias por
// servidor de la interfaz) y la comparación que enseña «Ver». Lo cambia scheduler.ts; lo leen la pestaña
// Auditoría y «Auditar proyecto».
import { create } from "zustand";
import { parseSchedules, type Schedules, type ServerChange } from "./schedule";

const KEY = "sshorus.audit.schedule.v1";

interface AuditScheduleState {
  entries: Schedules;
  /** Comparación abierta (null = cerrada). */
  changes: ServerChange[] | null;
}

function read(): Schedules {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSchedules(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function write(entries: Schedules) {
  try {
    if (Object.keys(entries).length) localStorage.setItem(KEY, JSON.stringify(entries));
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento: la programación dura hasta cerrar SSHorus.
  }
}

export const useAuditSchedule = create<AuditScheduleState>(() => ({ entries: read(), changes: null }));

export function updateSchedules(fn: (s: Schedules) => Schedules): void {
  const prev = useAuditSchedule.getState().entries;
  const next = fn(prev);
  if (next === prev) return;
  useAuditSchedule.setState({ entries: next });
  write(next);
}

export function openAuditChanges(changes: ServerChange[]): void {
  useAuditSchedule.setState({ changes });
}

export function closeAuditChanges(): void {
  useAuditSchedule.setState({ changes: null });
}
