// Motor del Panel de VPS conectado a SSHorus (pestañas, conexión en segundo plano, canal exec).
// Uno para todas las pestañas del panel: lo arranca la primera al mostrarse y se detiene (cerrando las
// conexiones que abrió) al cerrar la última. Mientras tanto mantiene sus conexiones, como una pestaña
// de servidor, pero solo lee con una pestaña del panel a la vista (y la ventana visible y sin bloqueo).
import { create } from "zustand";
import { snippets } from "../../api/snippets";
import { ssh } from "../../api/ssh";
import type { ServerProfile } from "../../api/types";
import { useProfiles } from "../../stores/profiles";
import { useTabs } from "../../stores/tabs";
import { openOrFocusServer } from "../connect";
import { useLock } from "../lock/lockStore";
import { connectInBackground } from "../multirun/connect";
import { fleetTargets, groupVps, type Vps } from "./group";
import type { VpsLive } from "./health";
import { FleetPoller, type PollerDeps } from "./poller";
import { useFleet } from "./store";
import { isFleetTabId, useFleetTabs } from "./tabs";

export const useFleetLive = create<{ live: Record<string, VpsLive> }>(() => ({ live: {} }));

const liveTabs = (ids: string[], status: "connected" | "reconnecting") =>
  useTabs.getState().tabs.filter((t) => ids.includes(t.profileId) && t.status === status);

const realDeps: PollerDeps = {
  tabSession: (ids) => {
    const t = liveTabs(ids, "connected").slice(-1)[0];
    return t ? { profileId: t.profileId, sessionId: t.sessionId } : null;
  },
  tabReconnecting: (ids) => liveTabs(ids, "reconnecting").length > 0,
  connect: async (profileId) => (await ssh.connect(profileId)).id,
  connectInteractive: async (profileId) => {
    const profile = useProfiles.getState().getServer(profileId);
    if (!profile) throw new Error("El servidor ya no existe");
    return connectInBackground(profile);
  },
  exec: (sessionId, command, timeoutSecs) => snippets.exec(sessionId, command, timeoutSecs),
  disconnect: (sessionId) => ssh.disconnect(sessionId),
  now: () => Date.now(),
};

let poller: FleetPoller | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Solo se lee con una pestaña del panel a la vista, la ventana visible y SSHorus sin bloquear. */
function reading(): boolean {
  return !document.hidden && isFleetTabId(useTabs.getState().activeTabId) && !useLock.getState().status?.locked;
}

/** Lo llama cada pestaña del panel al mostrarse: arranca el motor si aún no corre. */
export function ensureFleet(): void {
  if (poller) return;
  poller = new FleetPoller(realDeps, (live) => useFleetLive.setState({ live }), useFleet.getState().intervalSecs * 1000);
  timer = setInterval(() => {
    if (reading()) poller?.pump();
  }, 1000);
  refreshTargets();
}

function stopFleet(): void {
  if (timer) clearInterval(timer);
  timer = null;
  poller?.dispose();
  poller = null;
  useFleetLive.setState({ live: {} });
}

/** VPS de todas las pestañas abiertas del panel; los que ya no salen en ninguna cierran su conexión. */
function refreshTargets(): void {
  if (!poller) return;
  const { servers, projects } = useProfiles.getState();
  const scopes = useFleetTabs.getState().tabs.map((t) => t.projectId);
  poller.setTargets(fleetTargets(groupVps(servers, projects), scopes));
  if (reading()) poller.pump();
}

useFleetTabs.subscribe((s) => (s.tabs.length > 0 ? refreshTargets() : stopFleet()));
useProfiles.subscribe((s, prev) => {
  if (s.servers !== prev.servers || s.projects !== prev.projects) refreshTargets();
});
useFleet.subscribe((s, prev) => {
  if (s.intervalSecs !== prev.intervalSecs) poller?.setIntervalMs(s.intervalSecs * 1000);
});

export const fleetConnect = (key: string) => void poller?.connectNow(key);
export const fleetRetry = (key: string) => poller?.retryNow(key);

/**
 * Abre (o enfoca) la pestaña de ese VPS con `profile` (por defecto, el que usa el panel); el panel
 * sigue abierto. Si ya tiene una conexión con ese perfil, la pestaña se queda con ella (no se vuelve
 * a autenticar) y el panel pasa a leer por la pestaña.
 */
export function openVps(v: Vps, profile?: ServerProfile): void {
  const live = useFleetLive.getState().live[v.key];
  const target = profile ?? v.profiles.find((p) => p.id === live?.profileId) ?? v.profiles[0];
  if (!target) return;
  const hasTab = useTabs.getState().tabs.some((t) => t.profileId === target.id);
  const s = !hasTab && live?.owned && live.profileId === target.id ? poller?.handOver(v.key) : null;
  if (s) {
    const info = { id: s.sessionId, profileId: target.id, name: target.name, host: target.host, port: target.port, username: target.username, connectedAt: Date.now() };
    useTabs.getState().openSession(info, { color: target.color, initialPath: target.defaultPath });
    return;
  }
  void openOrFocusServer(target);
}
