// Pestañas de conexión (una por sesión SSH) y su menú contextual.
import { useCallback, useState, type CSSProperties } from "react";
import { Copy, RotateCw, Unplug, X, XCircle } from "lucide-react";
import { useTabs } from "../../stores/tabs";
import { useProfiles } from "../../stores/profiles";
import { cancelReconnect, connectToServer, reconnectTab, requestCloseTab } from "../../features/connect";
import { tabCurrentPath, useEditorDirty } from "../../stores/sessionState";
import { useShortcutText, withShortcut } from "../../features/shortcuts/shortcuts";
import { PopupMenu } from "../ui/PopupMenu";
import type { TabBarHooks } from "../Fleet/FleetTabs";
import { PrivilegeBadge } from "./PrivilegeBadge";
import { STATUS_LABEL, tabClass, tabTooltip } from "./tabLabels";

export function SessionTabs({ bar }: { bar: TabBarHooks }) {
  const tabs = useTabs((s) => s.tabs);
  const setActive = useTabs((s) => s.setActive);
  const dirty = useEditorDirty((s) => s.dirty);
  const profiles = useProfiles((s) => s.servers);
  const closeKeys = useShortcutText("tabs.close");
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) : undefined;

  return (
    <>
      {tabs.map((t) => {
        const active = t.id === bar.activeId;
        const unsaved = (dirty[t.sessionId]?.length ?? 0) > 0;
        const cls = tabClass("tabs-tab", active && "active", t.status !== "connected" && t.status, bar.dragId === t.id && "dragging");
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cls}
            style={t.color ? ({ "--tab-color": t.color } as CSSProperties) : undefined}
            title={tabTooltip(t)}
            onPointerDown={(e) => bar.onPointerDown(e, t.id)}
            onPointerMove={bar.onPointerMove}
            onPointerUp={bar.endDrag}
            onPointerCancel={bar.endDrag}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void requestCloseTab(t.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const i = tabs.findIndex((x) => x.id === t.id);
                const n = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                setActive(n.id);
                e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(n.id)}"]`)?.focus();
              } else if (e.key === "Delete") {
                void requestCloseTab(t.id);
              }
            }}
          >
            {t.color && <span className="tabs-color" />}
            <span className={`tabs-status ${t.status}`} role="img" aria-label={STATUS_LABEL[t.status]} />
            <span className="tabs-title">{t.title}</span>
            <PrivilegeBadge sessionId={t.sessionId} />
            <button
              className={unsaved ? "tabs-close unsaved" : "tabs-close"}
              title={unsaved ? "Cerrar (hay archivos sin guardar)" : withShortcut("Cerrar", closeKeys)}
              aria-label={`Cerrar ${t.title}`}
              tabIndex={-1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void requestCloseTab(t.id);
              }}
            >
              <span className="tabs-unsaved-dot" />
              <X size={13} />
            </button>
          </div>
        );
      })}

      {menu && menuTab && (
        <PopupMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {menuTab.status === "closed" && (
            <button
              role="menuitem"
              onClick={() => {
                closeMenu();
                void reconnectTab(menuTab.id);
              }}
            >
              <RotateCw size={14} /> Reconectar
            </button>
          )}
          {menuTab.status === "reconnecting" && (
            <button
              role="menuitem"
              onClick={() => {
                closeMenu();
                void cancelReconnect(menuTab.id);
              }}
            >
              <Unplug size={14} /> Dejar de reconectar
            </button>
          )}
          <button
            role="menuitem"
            disabled={!profiles.some((p) => p.id === menuTab.profileId)}
            onClick={() => {
              closeMenu();
              const p = useProfiles.getState().servers.find((s) => s.id === menuTab.profileId);
              if (p) void connectToServer(p, { initialPath: tabCurrentPath(menuTab) });
            }}
          >
            <Copy size={14} /> Duplicar conexión
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              void requestCloseTab(menuTab.id);
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
