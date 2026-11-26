// «Cerrar las demás»: cierra todas las pestañas de la barra menos una.
import { useTabs } from "../../stores/tabs";
import { requestCloseTab } from "../../features/connect";
import { closeLocalTab, useLocalTabs } from "../../features/localterm/store";
import { closeFleetTab, fleetTabIds } from "../../features/fleet/tabs";

export async function closeOtherTabs(keepId: string): Promise<void> {
  for (const t of useTabs.getState().tabs) {
    if (t.id === keepId) continue;
    // Si el usuario cancela (archivos sin guardar), no se sigue cerrando.
    const ok = await requestCloseTab(t.id);
    if (!ok) return;
  }
  for (const t of useLocalTabs.getState().tabs) if (t.id !== keepId) closeLocalTab(t.id);
  for (const id of fleetTabIds()) if (id !== keepId) closeFleetTab(id);
  useTabs.getState().setActive(keepId);
}
