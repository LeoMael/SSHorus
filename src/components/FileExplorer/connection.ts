// Estado de la conexión de la pestaña (reconexión automática / cierre definitivo).
import { useTabs } from "../../stores/tabs";

/** ¿La conexión de la pestaña está activa? (sin pestaña = se asume que sí). */
export function sessionOnline(sessionId: string): boolean {
  const t = useTabs.getState().tabs.find((x) => x.sessionId === sessionId);
  return !t || t.status === "connected";
}

export function useTabConnection(sessionId: string) {
  const tabStatus = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.status ?? "connected");
  const closedReason = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.closedReason ?? null);
  const reconnectCount = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.reconnectCount ?? 0);
  const serverId = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.profileId ?? null);
  return { tabStatus, closedReason, reconnectCount, offline: tabStatus !== "connected", serverId };
}
