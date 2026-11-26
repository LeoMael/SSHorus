// Estado del análisis de vulnerabilidades, por sesión (fases, progreso, último informe y usuarios con
// contenedores), y cómo se cambia. Vive en un store para que cambiar de sub-pestaña no pierda un análisis
// en curso.
import { create } from "zustand";
import type { Report, UsersView } from "../../api/vulnscan";
import { useStoreUsers } from "../containers/storeUsers";

export type PhaseId = "detect" | "inventory" | "distro" | "images" | "osv";
export type PhaseStatus = "pending" | "running" | "ok" | "warn" | "skipped" | "error";

export interface Phase {
  id: PhaseId;
  label: string;
  status: PhaseStatus;
  detail: string | null;
}

export interface ScanRun {
  scanId: string;
  running: boolean;
  phases: Phase[];
  /** Texto de lo que se está haciendo ahora. */
  progress: string;
  /** Error que paró el análisis (no los avisos de fase). */
  error: string | null;
  canceled: boolean;
  startedAt: number;
  /** sudo rechazó la contraseña (en memoria o guardada): se siguió sin sudo y no se volvió a probar. */
  sudoRejected?: boolean;
}

interface VulnState {
  /** Por sesión. */
  runs: Record<string, ScanRun>;
  /** Último informe mostrado, por sesión. */
  reports: Record<string, Report | null>;
  /** Usuarios con almacén de contenedores (leídos con sudo), por sesión: copia de la lista de
   *  features/containers/storeUsers.ts para la pestaña del escáner. */
  users: Record<string, UsersView | null>;
  setReport: (sessionId: string, r: Report | null) => void;
  /** Olvida el informe en memoria: se vuelve a leer el último del historial. */
  clearReport: (sessionId: string) => void;
}

export const useVulnScan = create<VulnState>((set) => ({
  runs: {},
  reports: {},
  users: useStoreUsers.getState().bySession,
  setReport: (sessionId, r) => set((s) => ({ reports: { ...s.reports, [sessionId]: r } })),
  clearReport: (sessionId) =>
    set((s) => {
      const reports = { ...s.reports };
      delete reports[sessionId];
      return { reports };
    }),
}));

useStoreUsers.subscribe((s, prev) => {
  if (s.bySession !== prev.bySession) useVulnScan.setState({ users: s.bySession });
});

export const PHASES: { id: PhaseId; label: string }[] = [
  { id: "detect", label: "Detectar el sistema" },
  { id: "inventory", label: "Inventario de paquetes y programas" },
  { id: "distro", label: "Herramienta de seguridad de la distro" },
  { id: "images", label: "Contenedores e imágenes" },
  { id: "osv", label: "Consultar OSV.dev y juntar" },
];

export function patchRun(sessionId: string, f: (r: ScanRun) => ScanRun) {
  useVulnScan.setState((s) => {
    const r = s.runs[sessionId];
    return r ? { runs: { ...s.runs, [sessionId]: f(r) } } : s;
  });
}

export function setPhase(sessionId: string, id: PhaseId, status: PhaseStatus, detail: string | null = null) {
  patchRun(sessionId, (r) => ({ ...r, phases: r.phases.map((p) => (p.id === id ? { ...p, status, detail } : p)) }));
}

export function setProgress(sessionId: string, text: string) {
  patchRun(sessionId, (r) => ({ ...r, progress: text }));
}
