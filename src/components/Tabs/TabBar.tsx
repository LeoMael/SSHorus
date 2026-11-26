// Barra de pestañas: las de conexión (una por sesión SSH) y, detrás, las de terminal local («Este equipo»)
// y las del Panel de VPS.
import { useEffect, useRef } from "react";
import { CircleHelp, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { useTabs } from "../../stores/tabs";
import { useUi } from "../../stores/ui";
import { Logo } from "../ui/Logo";
import { LockButton } from "./LockButton";
import { McpButton } from "../../features/mcp/McpButton";
import { openManual } from "../../stores/settingsNav";
import { useLocalTabs } from "../../features/localterm/store";
import { useFleetTabs } from "../../features/fleet/tabs";
import { FleetTabs, type TabBarHooks } from "../Fleet/FleetTabs";
import { useShortcutText, withShortcut } from "../../features/shortcuts/shortcuts";
import { SessionTabs } from "./SessionTabs";
import { LocalTabs } from "./LocalTabs";
import { NewTabButtons } from "./NewTabButtons";
import { closeOtherTabs } from "./closeOthers";
import { useTabDrag } from "./useTabDrag";
import "./TabBar.css";

export function TabBar() {
  const sidebarKeys = useShortcutText("app.sidebar");
  const settingsKeys = useShortcutText("app.settings");
  const tabCount = useTabs((s) => s.tabs.length);
  const localCount = useLocalTabs((s) => s.tabs.length);
  const fleetCount = useFleetTabs((s) => s.tabs.length);
  const activeId = useTabs((s) => s.activeTabId);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const openSettings = useUi((s) => s.openSettings);
  const listRef = useRef<HTMLDivElement>(null);
  const { dragId, onPointerDown, onPointerMove, endDrag } = useTabDrag(listRef);

  // Mantener visible la pestaña activa.
  useEffect(() => {
    if (!activeId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabCount]);

  const bar: TabBarHooks = {
    activeId,
    dragId,
    onPointerDown,
    onPointerMove,
    endDrag,
    closeOthers: (id) => void closeOtherTabs(id),
    canCloseOthers: tabCount + localCount + fleetCount > 1,
  };

  return (
    <div className="tabs-bar">
      <button
        className="icon-btn tabs-side-btn"
        onClick={toggleSidebar}
        title={withShortcut(`${sidebarCollapsed ? "Mostrar" : "Ocultar"} barra lateral`, sidebarKeys)}
        aria-label="Mostrar u ocultar barra lateral"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {sidebarCollapsed && <Logo size={18} className="tabs-logo" />}
      <div className="tabs-list" ref={listRef} role="tablist" aria-label="Conexiones abiertas">
        <SessionTabs bar={bar} />
        <LocalTabs bar={bar} />
        <FleetTabs bar={bar} />
        <NewTabButtons />
      </div>
      <McpButton />
      <LockButton />
      <button className="icon-btn tabs-side-btn" onClick={openManual} title="Manual de uso" aria-label="Manual de uso">
        <CircleHelp size={16} />
      </button>
      <button className="icon-btn tabs-side-btn" onClick={openSettings} title={withShortcut("Ajustes", settingsKeys)} aria-label="Ajustes">
        <Settings size={16} />
      </button>
    </div>
  );
}
