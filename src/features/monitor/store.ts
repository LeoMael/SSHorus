// Datos del Monitor por sesión (store de zustand). Lo escribe el motor de muestreo (engine.ts) y lo
// leen el panel y el resumen de conexiones.
import { create } from "zustand";
import type { SampleInfo } from "./sample";
import type { ContainersResult } from "./containers";
import type { HistoryPoint, Metrics } from "./derive";
import type { ActiveAlert } from "./alerts";

export interface ContainersState {
  result: ContainersResult | null;
  error: string | null;
  loading: boolean;
  at: number | null;
}

export interface SessionMonitor {
  metrics: Metrics | null;
  history: HistoryPoint[];
  /** Último error del muestreo (se conservan los datos anteriores). */
  error: string | null;
  /** Hay un muestreo en curso. */
  loading: boolean;
  /** El servidor no expone /proc (no es Linux). */
  noProc: boolean;
  info: SampleInfo | null;
  /** La última muestra se leyó con sudo (se ven los procesos de todos aunque /proc tenga hidepid). */
  elevated: boolean;
  alerts: ActiveAlert[];
  containers: ContainersState;
}

export const EMPTY_CONTAINERS: ContainersState = { result: null, error: null, loading: false, at: null };

export const emptyMonitor = (): SessionMonitor => ({
  metrics: null,
  history: [],
  error: null,
  loading: false,
  noProc: false,
  info: null,
  elevated: false,
  alerts: [],
  containers: EMPTY_CONTAINERS,
});

interface MonitorStore {
  bySession: Record<string, SessionMonitor>;
  patch: (sessionId: string, p: Partial<SessionMonitor>) => void;
  drop: (sessionId: string) => void;
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  bySession: {},
  patch: (sessionId, p) =>
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: { ...(s.bySession[sessionId] ?? emptyMonitor()), ...p } } })),
  drop: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.bySession)) return s;
      const bySession = { ...s.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
}));

/** Datos de una sesión (null si nunca se muestreó). */
export function useSessionMonitor(sessionId: string): SessionMonitor | null {
  return useMonitorStore((s) => s.bySession[sessionId] ?? null);
}
