// Notificaciones pequeñas (esquina inferior derecha). BASE compartida.
import { create } from "zustand";
import { errorMessage } from "../api/core";

export type ToastKind = "info" | "success" | "error";

/** Botón opcional del aviso (p. ej. «Ver» o «Deshacer»). Al pulsarlo se cierra el aviso. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Cuánto se ve (ms). Por defecto 4,5 s; los errores y los que llevan botón, más. */
  ms?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">, ms?: number) => number;
  dismiss: (id: number) => void;
  /** Para la cuenta atrás mientras el ratón o el foco están en el aviso (para poder leerlo o pulsar su botón). */
  hold: (id: number, on: boolean) => void;
}

/** Tiempo que queda al soltar un aviso que se había parado. */
const RESUME_MS = 2500;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToasts = create<ToastState>((set, get) => {
  const arm = (id: number, ms: number) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), ms),
    );
  };
  return {
    toasts: [],
    push: (t, ms = 4500) => {
      const id = nextId++;
      set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
      arm(id, ms);
      return id;
    },
    dismiss: (id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
    hold: (id, on) => {
      if (!get().toasts.some((t) => t.id === id)) return;
      if (on) clearTimeout(timers.get(id));
      else arm(id, RESUME_MS);
    },
  };
});

const show = (kind: ToastKind, title: string, message: string | undefined, o: ToastOptions | undefined, base: number) =>
  useToasts.getState().push({ kind, title, message, action: o?.action }, o?.ms ?? (o?.action ? Math.max(base, 8000) : base));

export const toast = {
  info: (title: string, message?: string, o?: ToastOptions) => show("info", title, message, o, 4500),
  success: (title: string, message?: string, o?: ToastOptions) => show("success", title, message, o, 4500),
  error: (title: string, err?: unknown, o?: ToastOptions) => show("error", title, err === undefined ? undefined : errorMessage(err), o, 7000),
};
