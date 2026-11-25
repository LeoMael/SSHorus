// «Ver en Contenedores» desde otras partes (p. ej. Monitor → Por usuario): pide al panel de Contenedores
// de esa sesión que muestre los de un dueño («self», «root» o «u:<usuario>»). Abrir la pestaña lo hace
// `useInfraNav` (useNavRequests).
import { create } from "zustand";

export interface OwnerNavRequest {
  sessionId: string;
  owner: string;
  seq: number;
}

interface NavState {
  request: OwnerNavRequest | null;
  open: (sessionId: string, owner: string) => void;
  /** El panel ya eligió ese dueño. */
  done: (seq: number) => void;
}

let seq = 0;

export const useOwnerNav = create<NavState>((set) => ({
  request: null,
  open: (sessionId, owner) => set({ request: { sessionId, owner, seq: ++seq } }),
  done: (s) => set((st) => (st.request?.seq === s ? { request: null } : st)),
}));
