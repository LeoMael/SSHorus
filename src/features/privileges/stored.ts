// Contraseña de sudo guardada (o la de la conexión) de cada servidor: se lee del motor cuando un panel
// que eleva la necesita, se comprueba con `sudo -v` y queda en memoria (ver sudo.ts). Aparte de sudo.ts
// para que la ventana principal no cargue los servidores antes de tiempo. Todos los sitios que piden
// la contraseña de sudo pasan por `obtainSudoPassword` (el diálogo la llama antes de preguntar).
import { useEffect } from "react";
import { profiles } from "../../api/profiles";
import type { SudoMode } from "../../api/types";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { useLock } from "../lock/lockStore";
import type { PrivilegeInfo } from "./detect";
import { otherSessionPasswords, storedFailed, storedStateAfterConfirm, sudoLookupPlan, type SudoSource } from "./lookup";
import { confirmSudo, setStoredSudo, useSudo } from "./sudo";

/** Modo de sudo efectivo de un servidor («login» solo si entra con contraseña). Con «login» vale la
 * contraseña guardada de la conexión o, si no se guardó, la que se escribió al conectar esa sesión (el
 * motor la guarda en memoria mientras dure la sesión; se borra al cerrarla o al bloquear SSHorus). */
export function sudoModeOf(profileId: string): SudoMode {
  const srv = useProfiles.getState().getServer(profileId);
  const mode = srv?.sudoMode ?? "ask";
  return mode === "login" && srv?.auth !== "password" ? "ask" : mode;
}

/** Necesita contraseña (sudo con contraseña, o «puede que tenga sudo»). */
function needsPassword(info: PrivilegeInfo | null): boolean {
  return !!info && info.hasSudo && info.level !== "root" && info.level !== "sudo-nopasswd" && info.level !== "user";
}

// Lectura en curso por sesión: el panel que se abre, el diálogo y la acción que pide sudo esperan a la
// misma (así el diálogo no salta mientras la guardada aún se está comprobando).
const inflight = new Map<string, Promise<void>>();

/**
 * Si el servidor usa una contraseña guardada (o la de la conexión), la lee del motor, la comprueba con
 * sudo y la deja en memoria. Una vez por sesión (se repite tras reconectar, desbloquear o guardar el
 * servidor; y si falló por algo pasajero, la próxima vez que se pida). Nunca lanza.
 */
export function loadStoredSudo(sessionId: string, profileId: string): Promise<void> {
  const cur = inflight.get(sessionId);
  if (cur) return cur;
  const p = readAndConfirm(sessionId, profileId).finally(() => {
    if (inflight.get(sessionId) === p) inflight.delete(sessionId);
  });
  inflight.set(sessionId, p);
  return p;
}

async function readAndConfirm(sessionId: string, profileId: string): Promise<void> {
  if (sudoModeOf(profileId) === "ask") {
    setStoredSudo(sessionId, "none");
    return;
  }
  setStoredSudo(sessionId, "loading");
  let pw: string | null;
  try {
    pw = await profiles.sudoPassword(profileId, sessionId);
  } catch {
    // Bloqueado o llavero no disponible: pasajero, se vuelve a mirar la próxima vez que se pida.
    if (useSudo.getState().stored[sessionId] === "loading") setStoredSudo(sessionId, "retry");
    return;
  }
  if (useSudo.getState().stored[sessionId] !== "loading") return; // se olvidó mientras tanto
  if (!pw) {
    setStoredSudo(sessionId, "none");
    return;
  }
  const r = await confirmSudo(sessionId, pw);
  if (useSudo.getState().stored[sessionId] !== "loading") return;
  setStoredSudo(sessionId, storedStateAfterConfirm(r));
}

/** Resultado de `obtainSudoPassword`. */
export type SudoObtainResult =
  | { ok: true; source: Exclude<SudoSource, "ask"> }
  /** Hay que preguntar. `storedFailed`: sudo rechazó la guardada (o la de la conexión).
   * `storedUnavailable`: no se pudo usar ahora (llavero o bóveda no disponible, sudo tardó). */
  | { ok: false; storedFailed: boolean; storedUnavailable: boolean };

/**
 * Única forma de conseguir la contraseña de sudo de una conexión (orden en lookup.ts): en memoria →
 * guardada → otra pestaña del mismo servidor → hay que preguntar. Si la consigue, queda en memoria de
 * esta sesión. `fromDialog`: lo pide el diálogo justo antes de preguntar (vuelve a mirar la guardada aunque
 * antes no hubiera). Nunca lanza.
 */
export async function obtainSudoPassword(
  sessionId: string,
  profileId: string,
  opts: { fromDialog?: boolean } = {},
): Promise<SudoObtainResult> {
  const st = useSudo.getState();
  const others = otherSessionPasswords(useTabs.getState().tabs, st.bySession, sessionId, profileId);
  const plan = sudoLookupPlan({
    hasMemory: sessionId in st.bySession,
    stored: st.stored[sessionId],
    mode: sudoModeOf(profileId),
    otherSessions: others.length,
    fromDialog: opts.fromDialog,
  });
  for (const step of plan) {
    if (step === "memory") return { ok: true, source: "memory" };
    if (step === "stored") {
      if (useLock.getState().status?.locked) continue;
      await loadStoredSudo(sessionId, profileId);
      if (sessionId in useSudo.getState().bySession) return { ok: true, source: "stored" };
    } else if (step === "other-session") {
      for (const pw of others) {
        if (useSudo.getState().stored[sessionId] === "off") break;
        const r = await confirmSudo(sessionId, pw);
        if (r.ok) return { ok: true, source: "other-session" };
      }
    }
  }
  if (sessionId in useSudo.getState().bySession) return { ok: true, source: "memory" };
  // Nada sirvió: se apunta para que los paneles no lo reintenten solos cada vez que se abren (cada
  // intento fallido cuenta para sudo y puede bloquear la cuenta). El diálogo sí vuelve a mirar; guardar el
  // servidor o desbloquear lo pone a cero (resetStoredSudo).
  const live = useTabs.getState().tabs.some((t) => t.sessionId === sessionId && t.status !== "closed");
  if (live && useSudo.getState().stored[sessionId] === undefined) setStoredSudo(sessionId, "none");
  const end = useSudo.getState().stored[sessionId];
  return { ok: false, storedFailed: storedFailed(end), storedUnavailable: end === "retry" };
}

/** Hook para los paneles que elevan (Administración, Contenedores): busca la contraseña (guardada u
 * otra pestaña del mismo servidor) cuando el panel está activo y hace falta, sin preguntar. Al guardar el
 * servidor o desbloquear, el estado vuelve a «sin mirar» (resetStoredSudo) y se busca otra vez. */
export function useStoredSudo(sessionId: string, profileId: string, info: PrivilegeInfo | null, active: boolean): void {
  const hasPassword = useSudo((s) => sessionId in s.bySession);
  const state = useSudo((s) => s.stored[sessionId]);
  const locked = useLock((s) => !!s.status?.locked);
  const need = needsPassword(info);
  useEffect(() => {
    if (!active || locked || hasPassword || !need || state !== undefined) return;
    void obtainSudoPassword(sessionId, profileId);
  }, [active, locked, hasPassword, need, state, sessionId, profileId]);
}
