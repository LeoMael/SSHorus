// Estado compartido de las sesiones: archivos con cambios sin guardar, carpeta actual y orden de las
// pestañas. Cerrar y reconectar (que conecta, pregunta y cierra tmux) está en features/connect/tabLifecycle.ts.
import { create } from "zustand";
import { useTabs } from "./tabs";

interface DirtyState {
  /** sessionId → rutas con cambios sin guardar */
  dirty: Record<string, string[]>;
  setDirty: (sessionId: string, path: string, dirty: boolean) => void;
  clearSession: (sessionId: string) => void;
}

export const useEditorDirty = create<DirtyState>((set) => ({
  dirty: {},
  setDirty: (sessionId, path, dirty) =>
    set((s) => {
      const cur = s.dirty[sessionId] ?? [];
      const has = cur.includes(path);
      if (dirty === has) return s;
      const next = dirty ? [...cur, path] : cur.filter((p) => p !== path);
      return { dirty: { ...s.dirty, [sessionId]: next } };
    }),
  clearSession: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.dirty)) return s;
      const rest = { ...s.dirty };
      delete rest[sessionId];
      return { dirty: rest };
    }),
}));

// ── Carpeta actual del explorador de cada sesión (para reconectar en el mismo sitio) ──
const currentPaths = new Map<string, string>();

/** El explorador informa la carpeta que muestra. */
export function setSessionPath(sessionId: string, path: string) {
  currentPaths.set(sessionId, path);
}

/** Carpeta actual de la pestaña (o la inicial si el explorador aún no informó ninguna). */
export function tabCurrentPath(tab: { sessionId: string; initialPath: string | null }): string | null {
  return currentPaths.get(tab.sessionId) ?? tab.initialPath;
}

/** Olvida lo guardado de una sesión que se cierra (archivos sin guardar y carpeta actual). */
export function forgetSession(sessionId: string) {
  useEditorDirty.getState().clearSession(sessionId);
  currentPaths.delete(sessionId);
}

/** Mueve una pestaña a otra posición (arrastrar para reordenar). */
export function moveTab(tabId: string, toIndex: number) {
  useTabs.setState((s) => {
    const from = s.tabs.findIndex((t) => t.id === tabId);
    if (from < 0 || from === toIndex) return s;
    const tabs = [...s.tabs];
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
    return { tabs };
  });
}
