// «Abrir carpeta en el explorador» desde otras partes (p. ej. Contenedores → Compose): pide a la pestaña
// de esa sesión que muestre «Archivos» en esa carpeta.
import { create } from "zustand";

export interface ExplorerNavRequest {
  sessionId: string;
  path: string;
  seq: number;
}

interface NavState {
  request: ExplorerNavRequest | null;
  open: (sessionId: string, path: string) => void;
  /** El explorador ya fue a la carpeta. */
  done: (seq: number) => void;
}

let seq = 0;

export const useExplorerNav = create<NavState>((set) => ({
  request: null,
  open: (sessionId, path) => set({ request: { sessionId, path, seq: ++seq } }),
  done: (s) => set((st) => (st.request?.seq === s ? { request: null } : st)),
}));
