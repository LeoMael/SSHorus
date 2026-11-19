// Al escribir en la terminal desde otra parte (Biblioteca de comandos, escáner…), la pestaña de la
// conexión pasa a verse y el panel de la terminal se despliega si estaba plegado: lo escrito se ve al
// momento (antes quedaba oculto y, sin verlo, se pulsaba «Insertar» varias veces).
import { useEffect, type RefObject } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { useTabs } from "../../stores/tabs";
import { registerTerminalRevealer } from "../../stores/terminalBus";

export function useTerminalReveal(sessionId: string, tabId: string, panel: RefObject<PanelImperativeHandle | null>) {
  useEffect(
    () =>
      registerTerminalRevealer(sessionId, () => {
        const tabs = useTabs.getState();
        if (tabs.activeTabId !== tabId) tabs.setActive(tabId);
        const p = panel.current;
        if (p?.isCollapsed()) p.expand();
      }),
    [sessionId, tabId, panel],
  );
}
