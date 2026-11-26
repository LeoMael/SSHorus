// Pestañas de terminal local («Este equipo»: shell o asistente de IA) y su menú contextual.
import { useCallback, useState } from "react";
import { Bot, Laptop, SquareTerminal, X, XCircle } from "lucide-react";
import { closeLocalTab, openLocalTab, useLocalTabs } from "../../features/localterm/store";
import { PopupMenu } from "../ui/PopupMenu";
import type { TabBarHooks } from "../Fleet/FleetTabs";
import { localTooltip, tabClass } from "./tabLabels";

export function LocalTabs({ bar }: { bar: TabBarHooks }) {
  const tabs = useLocalTabs((s) => s.tabs);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) : undefined;

  return (
    <>
      {tabs.map((t) => {
        const active = t.id === bar.activeId;
        const cls = tabClass("tabs-tab", "local", active && "active", t.status === "exited" && "exited", bar.dragId === t.id && "dragging");
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cls}
            title={localTooltip(t)}
            onPointerDown={(e) => bar.onPointerDown(e, t.id)}
            onPointerMove={bar.onPointerMove}
            onPointerUp={bar.endDrag}
            onPointerCancel={bar.endDrag}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeLocalTab(t.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete") closeLocalTab(t.id);
            }}
          >
            {t.kind === "shell" ? (
              <Laptop size={13} className="tabs-local-icon" aria-label="Este equipo" />
            ) : (
              <Bot size={13} className="tabs-local-icon" aria-label="Asistente de IA en este equipo" />
            )}
            <span className="tabs-title">{t.title}</span>
            <button
              className="tabs-close"
              title="Cerrar (termina lo que corre en ella)"
              aria-label={`Cerrar ${t.title}`}
              tabIndex={-1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeLocalTab(t.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}

      {menu && menuTab && (
        <PopupMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              openLocalTab({ kind: "shell", cwd: menuTab.cwd });
            }}
          >
            <SquareTerminal size={14} /> Otra terminal en esta carpeta
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              closeLocalTab(menuTab.id);
            }}
          >
            <X size={14} /> Cerrar
          </button>
          <button
            role="menuitem"
            disabled={!bar.canCloseOthers}
            onClick={() => {
              closeMenu();
              bar.closeOthers(menuTab.id);
            }}
          >
            <XCircle size={14} /> Cerrar las demás
          </button>
        </PopupMenu>
      )}
    </>
  );
}
