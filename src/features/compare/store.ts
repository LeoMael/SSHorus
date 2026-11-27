// Comparaciones abiertas: qué compara cada pestaña y el pedido de abrir una en la pestaña de su servidor.
import { create } from "zustand";
import { compareKey, type CompareSpec } from "./model";

export interface CompareRequest {
  /** Pestaña de servidor donde se abre la comparación. */
  sessionId: string;
  key: string;
  seq: number;
}

interface CompareState {
  specs: Record<string, CompareSpec>;
  request: CompareRequest | null;
  /** Abre una comparación en la pestaña de `sessionId`. Devuelve su clave. */
  open: (sessionId: string, spec: CompareSpec) => string;
  /** Cambia lo que compara una pestaña (p. ej. al intercambiar los lados). */
  update: (key: string, spec: CompareSpec) => void;
  /** La pestaña se cerró: olvidar lo que comparaba. */
  forget: (key: string) => void;
}

let seq = 0;

export const useCompare = create<CompareState>((set) => ({
  specs: {},
  request: null,
  open: (sessionId, spec) => {
    const key = compareKey(++seq, spec);
    set((s) => ({ specs: { ...s.specs, [key]: spec }, request: { sessionId, key, seq } }));
    return key;
  },
  update: (key, spec) => set((s) => (key in s.specs ? { specs: { ...s.specs, [key]: spec } } : s)),
  forget: (key) =>
    set((s) => {
      if (!(key in s.specs)) return s;
      const rest = { ...s.specs };
      delete rest[key];
      return { specs: rest };
    }),
}));
