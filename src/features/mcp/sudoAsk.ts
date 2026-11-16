// Contraseña de sudo para los comandos del asistente (petición `sudo` del motor, ver uiBridge.ts), para
// `request_sudo_password` ya permitida (petición `sudo-reveal`) y cola de diálogos de sudo que no son de un
// panel (también «Ejecutar en varios servidores» y los comandos con sudo de features/sudoRun:
// `sudoPasswordForCommand`).
// Los diálogos se muestran de uno en uno (SudoAskHost enseña el primero de la cola).
//
// Con «Aceptar automáticamente: todo» no se muestra nada si la contraseña ya está en memoria o guardada: el
// diálogo solo aparece (una vez) si no hay ninguna.
// Se consigue igual que en los paneles (`obtainSudoPassword`: en memoria → guardada → otra pestaña del
// mismo servidor) y, si no hay ninguna, con el diálogo de siempre (SudoDialog, mostrado por SudoAskHost).
// Queda en memoria de la conexión, la misma caché que usa la interfaz: si ya la escribiste en
// Administración no se vuelve a pedir, y al revés. El motor la pasa por stdin a un envoltorio que se la da
// a sudo; el asistente nunca la ve.
import { create } from "zustand";
import {
  detectPrivilege,
  getPrivilege,
  getSudoPassword,
  obtainSudoPassword,
  sudoPasswordNeeded,
  type PrivilegeInfo,
} from "../privileges";
import { useLock } from "../lock/lockStore";
import { useTabs } from "../../stores/tabs";
import { noPasswordWhy, sudoAskReason, type NoPasswordWhy, type SudoPurpose, type SudoReply } from "./sudoReply";

export type { SudoReply } from "./sudoReply";

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
  /** Texto de para qué se pide (por defecto, el del asistente). */
  reason?: string;
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

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Peticiones `sudo` (`purpose` "command") y `sudo-reveal` ("reveal") del motor: { sessionId, profileId,
 * serverName, timeoutSecs, auto, reason }. Las dos llegan ya permitidas por el usuario.
 */
export async function sudoForAssistant(payload: Record<string, unknown>, purpose: SudoPurpose = "command"): Promise<SudoReply> {
  const sessionId = str(payload.sessionId);
  if (!sessionId) throw new Error("Falta la conexión");
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId && t.status !== "closed");
  if (!tab) throw new Error("Esa conexión ya no está abierta en SSHorus");
  if (useLock.getState().status?.locked) throw new Error("SSHorus está bloqueado");
  const profileId = str(payload.profileId) ?? tab.profileId;
  const info = getPrivilege(sessionId) ?? (await detectPrivilege(sessionId));
  const secs = typeof payload.timeoutSecs === "number" && payload.timeoutSecs > 0 ? payload.timeoutSecs : 120;
  const serverName = str(payload.serverName) ?? tab.title;
  const auto = payload.auto === true;
  const got = await sudoPasswordForCommand({
    sessionId,
    profileId,
    info,
    serverName,
    auto,
    reason: sudoAskReason({ purpose, serverName, auto, reason: str(payload.reason) ?? undefined }),
    expiresAt: Date.now() + secs * 1000,
  });
  if (useLock.getState().status?.locked) throw new Error("SSHorus está bloqueado");
  if (!got) return { canceled: true };
  return "need" in got ? { elevate: false, why: got.why } : { elevate: true, password: got.password };
}
