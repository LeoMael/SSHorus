// Pestañas del Panel de VPS en la barra de pestañas (detrás de las de servidor y las de «Este equipo»).
import { useState, type PointerEvent as RPointerEvent } from "react";
import { LayoutDashboard, X, XCircle } from "lucide-react";
import { closeFleetTab, fleetTabTitle, useFleetTabs } from "../../features/fleet/tabs";
import { useShortcutText, withShortcut } from "../../features/shortcuts/shortcuts";
import { useProfiles } from "../../stores/profiles";
import { PopupMenu } from "../ui/PopupMenu";
import "./FleetTabs.css";

/** Lo que la barra comparte con todas sus pestañas: activa, arrastre y «Cerrar las demás». */
export interface TabBarHooks {
  activeId: string | null;
  dragId: string | null;
  onPointerDown: (e: RPointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove: (e: RPointerEvent<HTMLDivElement>) => void;
  endDrag: () => void;
  closeOthers: (keepId: string) => void;
  /** Hay más de una pestaña en la barra. */
  canCloseOthers: boolean;
}

export function FleetTabs({ bar }: { bar: TabBarHooks }) {
  const tabs = useFleetTabs((s) => s.tabs);
  const projects = useProfiles((s) => s.projects);
  const closeKeys = useShortcutText("tabs.close");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeMenu = () => setMenu(null);

  return (
    <>
      {tabs.map((t) => {
        const active = t.id === bar.activeId;
        const title = fleetTabTitle(t, projects);
        const cls = ["tabs-tab", "fleet", active && "active", bar.dragId === t.id && "dragging"].filter(Boolean).join(" ");
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cls}
            title={t.projectId ? "Estado de los VPS de este proyecto" : "Estado de todos tus VPS"}
            onPointerDown={(e) => bar.onPointerDown(e, t.id)}
            onPointerMove={bar.onPointerMove}
            onPointerUp={bar.endDrag}
            onPointerCancel={bar.endDrag}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeFleetTab(t.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: t.id, x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete") closeFleetTab(t.id);
            }}
          >
            <LayoutDashboard size={13} className="tabs-fleet-icon" aria-label="Panel de VPS" />
            <span className="tabs-title">{title}</span>
            <button
              className="tabs-close"
              title={withShortcut("Cerrar", closeKeys)}
              aria-label={`Cerrar ${title}`}
              tabIndex={-1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeFleetTab(t.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              closeFleetTab(menu.id);
            }}
          >
            <X size={14} /> Cerrar
          </button>
          <button
            role="menuitem"
            disabled={!bar.canCloseOthers}
            onClick={() => {
              closeMenu();
              bar.closeOthers(menu.id);
            }}
          >
            <XCircle size={14} /> Cerrar las demás
          </button>
        </PopupMenu>
      )}
    </>
  );
}
