// «Reiniciar ahora»: confirma, envía la orden con sudo (la contraseña de siempre: guardada, en memoria o
// el diálogo), avisa al motor para que la reconexión espere al arranque, sigue la caída y la vuelta de
// la pestaña y, al volver, comprueba que de verdad se reinició y si aún falta reiniciar.
// Las transiciones están en progress.ts (puras); aquí solo se ejecutan y se escuchan las pestañas.
import { create } from "zustand";
import { errorMessage } from "../../api/core";
import { snippets } from "../../api/snippets";
import { ssh } from "../../api/ssh";
import { reconnectTab, cancelReconnect } from "../../components/Session/sessionState";
import { useProfiles } from "../../stores/profiles";
import { useTabs, type SessionTab } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { openOrFocusServer } from "../connect";
import { buildExec, detectPrivilege, getPrivilege } from "../privileges";
import { execWithSudo, sudoFailureText, sudoRunError } from "../sudoRun";
import { parseStatus, rebootAccess, rebootCommand, rebootSent, statusScript, type ServerStatus } from "./commands";
import { confirmReboot } from "./confirm";
import { isActive, newRun, REBOOT_WAIT_SECS, rebootStep, serverKey, stillPending, type RebootEvent, type RebootRun } from "./progress";

export const useReboots = create<{ runs: Record<string, RebootRun> }>(() => ({ runs: {} }));

/** Se cierra solo un rato después de terminar bien (si ya no falta reiniciar). */
const AUTO_DISMISS_MS = 20_000;
const TICK_MS = 2000;

const doneListeners = new Set<(run: RebootRun) => void>();

/** Avisa cuando un reinicio termina bien (para refrescar informes). Devuelve la baja. */
export function onRebootDone(cb: (run: RebootRun) => void): () => void {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
}

/** Servidor (host:puerto) de un perfil; el id del perfil si ya no existe. */
export function keyOfProfile(profileId: string): string {
  const p = useProfiles.getState().getServer(profileId);
  return p ? serverKey(p) : profileId;
}

/** Pestañas abiertas de ese servidor (todas sus cuentas). */
function serverTabs(key: string): SessionTab[] {
  return useTabs.getState().tabs.filter((t) => keyOfProfile(t.profileId) === key);
}

function getRun(key: string): RebootRun | undefined {
  return useReboots.getState().runs[key];
}

function setRun(run: RebootRun) {
  useReboots.setState((s) => ({ runs: { ...s.runs, [run.key]: run } }));
}

/** Quita el aviso de un reinicio que ya terminó. */
export function dismissReboot(key: string): void {
  const run = getRun(key);
  if (!run || isActive(run.phase)) return;
  useReboots.setState((s) => {
    const runs = { ...s.runs };
    delete runs[key];
    return { runs };
  });
}

function forgetExpectation(sessionId: string) {
  ssh.expectReboot(sessionId, 0).catch(() => undefined);
}

function dispatch(key: string, ev: RebootEvent) {
  const prev = getRun(key);
  if (!prev) return;
  const next = rebootStep(prev, ev, Date.now());
  if (next === prev) return;
  setRun(next);
  if (next.phase === prev.phase) return;
  if (next.phase === "checking") void checkBack(key);
  if (next.phase === "failed" || next.phase === "stopped") forgetExpectation(next.sessionId);
  if (next.phase === "done") {
    for (const cb of doneListeners) cb(next);
    if (!stillPending(next) && !next.message) {
      setTimeout(() => {
        if (getRun(key) === next) dismissReboot(key);
      }, AUTO_DISMISS_MS);
    }
  }
}

function tabEvent(run: RebootRun): RebootEvent {
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === run.sessionId);
  if (!tab) return { type: "tab", status: "gone", reconnectCount: 0, reason: null };
  return { type: "tab", status: tab.status, reconnectCount: tab.reconnectCount, reason: tab.closedReason };
}

// ── Seguir las pestañas y el reloj mientras haya algún reinicio en curso ──
let unsubscribeTabs: (() => void) | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function activeRuns(): RebootRun[] {
  return Object.values(useReboots.getState().runs).filter((r) => isActive(r.phase));
}

function watch() {
  unsubscribeTabs ??= useTabs.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs) for (const r of activeRuns()) dispatch(r.key, tabEvent(r));
  });
  ticker ??= setInterval(() => {
    const runs = activeRuns();
    for (const r of runs) dispatch(r.key, { type: "tick" });
    if (runs.length === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }, TICK_MS);
}

/** Lee el estado del servidor (sin root, con sh sea cual sea el shell de login). Lanza si falla la conexión. */
async function readStatus(sessionId: string, pending: boolean): Promise<ServerStatus> {
  const req = buildExec(statusScript(pending), { kind: "none" });
  return parseStatus((await snippets.execStdin(sessionId, req.command, req.stdin, 45)).stdout);
}

async function checkBack(key: string) {
  const run = getRun(key);
  if (!run) return;
  try {
    dispatch(key, { type: "checked", status: await readStatus(run.sessionId, true) });
  } catch (e) {
    dispatch(key, { type: "check-failed", message: errorMessage(e) });
  }
}

/** Envía la orden. Un corte de la conexión mientras responde es lo esperado. */
async function send(key: string, sessionId: string, command: string) {
  try {
    await ssh.expectReboot(sessionId, REBOOT_WAIT_SECS);
  } catch (e) {
    dispatch(key, { type: "send-failed", message: errorMessage(e) });
    return;
  }
  try {
    const r = await execWithSudo(sessionId, command, { timeoutSecs: 60, action: "reiniciar el servidor" });
    if (!r) {
      forgetExpectation(sessionId);
      dispatch(key, { type: "stop" });
      dismissReboot(key);
      toast.info("Reinicio cancelado", "Sin la contraseña de sudo no se reinició.");
      return;
    }
    if (r.sudoFailure) dispatch(key, { type: "send-failed", message: sudoFailureText(r.sudoFailure) });
    else if (rebootSent(r.stdout)) dispatch(key, { type: "sent" });
    else dispatch(key, { type: "send-failed", message: sudoRunError(r) ?? "El servidor no confirmó la orden de reinicio." });
  } catch (e) {
    const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId);
    if (tab && tab.status !== "connected") dispatch(key, { type: "sent" });
    else dispatch(key, { type: "send-failed", message: errorMessage(e) });
  }
}

/** Botón «Reiniciar ahora»: pide confirmación y reinicia el servidor de esa conexión. */
export async function requestReboot(sessionId: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId);
  if (!tab || tab.status !== "connected") {
    toast.error("No se puede reiniciar", "La conexión con el servidor no está abierta.");
    return;
  }
  const key = keyOfProfile(tab.profileId);
  const cur = getRun(key);
  if (cur && isActive(cur.phase)) {
    toast.info("Ya se está reiniciando", tab.title);
    return;
  }
  const access = rebootAccess(getPrivilege(sessionId) ?? (await detectPrivilege(sessionId)));
  if (access.tool === null) {
    toast.error("No se puede reiniciar", access.why);
    return;
  }
  const command = rebootCommand(access.tool);
  const tabs = serverTabs(key).filter((t) => t.status !== "closed").length;
  if (!(await confirmReboot({ serverName: tab.title, command, tabs }))) return;
  const before = await readStatus(sessionId, false).catch(() => null);
  const fresh = useTabs.getState().tabs.find((t) => t.sessionId === sessionId);
  setRun(newRun({ key, serverName: tab.title, profileId: tab.profileId, sessionId, reconnectCount: fresh?.reconnectCount ?? 0, before }, Date.now()));
  watch();
  await send(key, sessionId, command);
}

/** «Dejar de esperar»: las pestañas que se estaban reconectando quedan con «Reconectar». */
export async function stopWaiting(key: string): Promise<void> {
  const run = getRun(key);
  if (!run || !isActive(run.phase)) return;
  dispatch(key, { type: "stop" });
  for (const t of serverTabs(key)) if (t.status === "reconnecting") await cancelReconnect(t.id);
}

/** Tras un fallo con la conexión cerrada: reconecta a mano (puede pedir contraseña una vez) y comprueba. */
export async function reconnectAfterReboot(key: string): Promise<void> {
  const run = getRun(key);
  if (!run?.canReconnect) return;
  const closed = serverTabs(key).filter((t) => t.status === "closed");
  for (const t of closed) await reconnectTab(t.id);
  const profile = useProfiles.getState().getServer(run.profileId);
  if (closed.length === 0 && profile) await openOrFocusServer(profile);
  const back = serverTabs(key).find((t) => t.status === "connected");
  if (back) dispatch(key, { type: "reconnected-by-hand", sessionId: back.sessionId });
  else toast.error("No se pudo reconectar", run.serverName);
}
