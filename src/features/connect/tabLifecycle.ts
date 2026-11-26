// Cerrar, reconectar y dejar de reconectar una pestaña de conexión. Vive aquí (y no en
// stores/sessionState.ts) porque conecta, muestra diálogos y cierra las sesiones de tmux: el store solo
// guarda el estado (archivos sin guardar y carpeta actual).
import { ssh } from "../../api/ssh";
import { confirmDialog } from "../../components/ui/dialogs";
import { basename } from "../../lib/paths";
import { useProfiles } from "../../stores/profiles";
import { forgetSession, moveTab, tabCurrentPath, useEditorDirty } from "../../stores/sessionState";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { useTransfers } from "../../stores/transfers";
import { killTmuxSessions, openTmuxNames } from "../tmux/index";
import { closeWarning } from "./closeConfirm";
import { connectToServer } from "./connect";

/** Transferencias sin terminar (en curso, en cola o en pausa) de una conexión. */
function pendingTransfers(sessionId: string): number {
  let n = 0;
  for (const b of Object.values(useTransfers.getState().batches)) {
    if (b.sessionId === sessionId) n += b.running + b.queued + b.paused;
  }
  return n;
}

/** Cierra una pestaña de conexión, pidiendo confirmación si hay archivos sin guardar o transferencias
 *  sin terminar (se cortarían). */
export async function requestCloseTab(tabId: string): Promise<boolean> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return false;
  const dirty = useEditorDirty.getState().dirty[tab.sessionId] ?? [];
  const warn = closeWarning(tab.title, dirty.map((p) => basename(p)), pendingTransfers(tab.sessionId));
  if (warn && !(await confirmDialog({ ...warn, danger: true }))) return false;
  forgetSession(tab.sessionId);
  // Cerrar la pestaña a propósito termina también sus terminales persistentes (tmux), igual que una
  // shell normal. Si la conexión ya se había perdido, quedan en el servidor y se pueden reabrir o
  // cerrar después desde «Sesiones en el servidor».
  if (tab.status === "connected") await killTmuxSessions(tab.sessionId, openTmuxNames(tab.sessionId));
  await useTabs.getState().closeTab(tabId);
  return true;
}

const reconnecting = new Set<string>();

/** Deja de reintentar una reconexión automática: la pestaña queda desconectada (con «Reconectar»). */
export async function cancelReconnect(tabId: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab || tab.status !== "reconnecting") return;
  try {
    await ssh.disconnect(tab.sessionId);
  } catch {
    /* ya estaba cerrada */
  }
  useTabs.getState().markClosed(tab.sessionId, "reconexión cancelada");
}

/** Reconecta una pestaña cerrada: abre una nueva conexión en la misma carpeta y cierra la vieja. */
export async function reconnectTab(tabId: string): Promise<void> {
  if (reconnecting.has(tabId)) return;
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const initialPath = tabCurrentPath(tab);
  const profile = useProfiles.getState().servers.find((s) => s.id === tab.profileId);
  if (!profile) {
    toast.error("No se puede reconectar", "El servidor ya no existe en tu lista.");
    return;
  }
  const dirty = useEditorDirty.getState().dirty[tab.sessionId] ?? [];
  if (dirty.length > 0) {
    const ok = await confirmDialog({
      title: "Cambios sin guardar",
      message: `Hay ${dirty.length === 1 ? "un archivo" : `${dirty.length} archivos`} con cambios sin guardar en esta conexión. Al reconectar se abrirá una pestaña nueva y esos cambios se perderán. Copia lo que necesites antes de seguir.`,
      confirmText: "Reconectar igualmente",
      danger: true,
    });
    if (!ok) return;
  }
  reconnecting.add(tabId);
  try {
    const oldIndex = useTabs.getState().tabs.findIndex((t) => t.id === tabId);
    const before = new Set(useTabs.getState().tabs.map((t) => t.id));
    // Las terminales persistentes (tmux) de la pestaña vieja se reabren en la nueva.
    const ok = await connectToServer(profile, { initialPath, restoreTerminals: openTmuxNames(tab.sessionId) });
    if (!ok) return;
    const fresh = useTabs.getState().tabs.find((t) => !before.has(t.id));
    forgetSession(tab.sessionId);
    await useTabs.getState().closeTab(tabId);
    if (fresh) {
      moveTab(fresh.id, oldIndex);
      useTabs.getState().setActive(fresh.id);
    }
  } finally {
    reconnecting.delete(tabId);
  }
}
