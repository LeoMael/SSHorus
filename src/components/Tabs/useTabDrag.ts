// Arrastrar pestañas para reordenarlas. Con punteros y no con arrastre HTML5: Tauri intercepta este último.
import { useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useTabs } from "../../stores/tabs";
import { moveTab } from "../../stores/sessionState";
import { moveLocalTab, useLocalTabs } from "../../features/localterm/store";
import { fleetTabIds, moveFleetTab } from "../../features/fleet/tabs";
import { slotInGroup } from "../../lib/tabOrder";

/** Grupos de la barra, en orden: cada uno se reordena solo dentro de sí. */
function barGroups(): { ids: string[]; move: (id: string, toIndex: number) => void }[] {
  return [
    { ids: useTabs.getState().tabs.map((t) => t.id), move: moveTab },
    { ids: useLocalTabs.getState().tabs.map((t) => t.id), move: moveLocalTab },
    { ids: fleetTabIds(), move: moveFleetTab },
  ];
}

export function useTabDrag(listRef: RefObject<HTMLDivElement | null>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    useTabs.getState().setActive(id);
    drag.current = { id, x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < 6) return;
      d.moved = true;
      setDragId(d.id);
    }
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []);
    const target = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    if (target < 0 || els[target].dataset.tabId === d.id) return;
    const groups = barGroups();
    const slot = slotInGroup(groups.map((g) => g.ids), d.id, target);
    if (slot) groups[slot.group].move(d.id, slot.index);
  };
  const endDrag = () => {
    drag.current = null;
    setDragId(null);
  };

  return { dragId, onPointerDown, onPointerMove, endDrag };
}
