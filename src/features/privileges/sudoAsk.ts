// Cola de diálogos de la contraseña de sudo que no son de un panel: comandos del asistente de IA (MCP),
// «Ejecutar en varios servidores» y los comandos con sudo de features/sudoRun. Los diálogos se muestran
// de uno en uno (components/Sudo/SudoAskHost.tsx enseña el primero de la cola).
//
// Se consigue igual que en los paneles (`obtainSudoPassword`: en memoria → guardada → otra pestaña del
// mismo servidor) y, si no hay ninguna, con el diálogo de siempre (SudoDialog). Queda en memoria de la
// conexión, la misma caché que usa la interfaz: si ya la escribiste en Administración no se vuelve a
// pedir, y al revés.
import { create } from "zustand";
import { useLock } from "../lock/lockStore";
import type { PrivilegeInfo } from "./detect";
import { noPasswordWhy, sudoPasswordNeeded, type NoPasswordWhy } from "./lookup";
import { getSudoPassword } from "./sudo";
import { getPrivilege } from "./store";
import { obtainSudoPassword } from "./stored";

export interface SudoAsk {
  id: string;
  sessionId: string;
  profileId: string;
  user: string | null;
  serverName: string;
  /** El comando se aceptó con «Aceptar automáticamente» (no hubo diálogo de permiso). */
  auto?: boolean;
  /** Unix ms: después se cierra solo (el motor ya no espera). Sin él, espera al usuario. */
  expiresAt?: number;
  /** Texto de para qué se pide (lo pone quien pregunta: el asistente, «Ejecutar en varios servidores»…). */
  reason: string;
  /** Texto del botón de cancelar (p. ej. «Saltar este servidor»). */
  cancelLabel?: string;
}

interface SudoAskState {
  asks: SudoAsk[];
}

export const useSudoAsks = create<SudoAskState>(() => ({ asks: [] }));

const waiting = new Map<string, (given: boolean) => void>();
let seq = 0;

/**
 * Pone en la cola el diálogo de la contraseña y espera a que se cierre. true = quedó en memoria de esa
 * sesión. Con `signal`, al abortar se quita de la cola (o se cierra si ya se veía) y da false.
 */
export function askSudoInDialog(a: Omit<SudoAsk, "id">, signal?: AbortSignal): Promise<boolean> {
  // Bloqueado: nada a la cola (si no, aparecería al desbloquear para algo que el motor ya no espera).
  if (signal?.aborted || useLock.getState().status?.locked) return Promise.resolve(false);
  const id = `sudo-${++seq}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    useSudoAsks.setState((s) => ({ asks: [...s.asks, { ...a, id }] }));
    signal?.addEventListener("abort", () => finishSudoAsk(id), { once: true });
  });
}

/** El diálogo se cerró (confirmada, cancelada, tiempo agotado o bloqueo). */
export function finishSudoAsk(id: string): void {
  const ask = useSudoAsks.getState().asks.find((a) => a.id === id);
  if (!ask && !waiting.has(id)) return;
  useSudoAsks.setState((s) => ({ asks: s.asks.filter((a) => a.id !== id) }));
  const resolve = waiting.get(id);
  waiting.delete(id);
  resolve?.(!!ask && getSudoPassword(ask.sessionId) !== undefined && !useLock.getState().status?.locked);
}

/** Al bloquear SSHorus: se cierran todos (el motor ya lo deniega). */
export function cancelAllSudoAsks(): void {
  for (const a of useSudoAsks.getState().asks) finishSudoAsk(a.id);
}

/**
 * Contraseña de sudo para ejecutar un comando fuera de los paneles (asistente, «Ejecutar en varios
 * servidores», comandos con sudo): la que ya hay o, si no, el diálogo en cola. `need: false` si no hace
 * falta (root, sudo sin contraseña, sin sudo; también si el diálogo lo comprobó). null = cancelado.
 */
export async function sudoPasswordForCommand(
  a: Omit<SudoAsk, "id" | "user"> & { info: PrivilegeInfo },
  signal?: AbortSignal,
): Promise<{ password: string } | { need: false; why: NoPasswordWhy } | null> {
  const { info, ...ask } = a;
  if (!sudoPasswordNeeded(info)) return { need: false, why: noPasswordWhy(info) };
  // Se pide para usarla ya: también se vuelve a mirar la guardada aunque antes no hubiera (como el diálogo).
  // Así, si está guardada, no se abre el diálogo ni un momento.
  const found = await obtainSudoPassword(a.sessionId, a.profileId, { fromDialog: true });
  if (signal?.aborted) return null;
  if (!found.ok && !(await askSudoInDialog({ ...ask, user: info.user }, signal))) {
    const now = getPrivilege(a.sessionId);
    return now && !sudoPasswordNeeded(now) ? { need: false, why: noPasswordWhy(now) } : null;
  }
  const password = getSudoPassword(a.sessionId);
  return password === undefined ? null : { password };
}
