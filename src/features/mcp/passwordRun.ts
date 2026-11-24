// Cola de diálogos de `run_with_password` (peticiones `password-run` y `password-prompt` del motor, ver
// passwordAsk.ts). PasswordRunHost los muestra de uno en uno; se cierran al bloquear SSHorus o al vencer.
import { create } from "zustand";
import { useLock } from "../lock/lockStore";
import { parseAsk, type PasswordAsk, type PasswordReply } from "./passwordAsk";


interface AsksState {
  asks: PasswordAsk[];
}

export const usePasswordAsks = create<AsksState>(() => ({ asks: [] }));

const waiting = new Map<string, (r: PasswordReply) => void>();
let seq = 0;

/** Pone el diálogo en la cola y espera la respuesta (petición del motor). */
export function askPasswordRun(kind: "run" | "prompt", payload: Record<string, unknown>): Promise<PasswordReply> {
  if (useLock.getState().status?.locked) return Promise.resolve({ canceled: true });
  const ask = parseAsk(`pw-${++seq}`, kind, payload);
  return new Promise((resolve) => {
    waiting.set(ask.id, resolve);
    usePasswordAsks.setState((s) => ({ asks: [...s.asks, ask] }));
  });
}

/** El diálogo se cerró con esta respuesta (o «no», al cerrarlo, al vencer o al bloquear). */
export function finishPasswordAsk(id: string, reply: PasswordReply = { canceled: true }): void {
  usePasswordAsks.setState((s) => ({ asks: s.asks.filter((a) => a.id !== id) }));
  const resolve = waiting.get(id);
  waiting.delete(id);
  resolve?.(reply);
}

export function cancelAllPasswordAsks(): void {
  for (const a of usePasswordAsks.getState().asks) finishPasswordAsk(a.id);
}
