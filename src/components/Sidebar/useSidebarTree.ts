// Árbol de la barra lateral: fila seleccionada, menú contextual abierto, teclado y «mostrar fila».
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { isModKey } from "../../lib/platform";
import type { MenuItem } from "./SbContextMenu";
import { isNavKey, navIndex } from "./sidebarLogic";

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function useSidebarTree() {
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** Fila que hay que mostrar (desplazar y enfocar) en cuanto aparezca, p. ej. un servidor recién añadido. */
  const [reveal, setReveal] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reveal) return;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sb-key]") ?? []).find(
      (el) => el.dataset.sbKey === reveal,
    );
    if (!row) return; // aún no está en la lista: se reintenta en el siguiente render
    row.scrollIntoView({ block: "nearest" });
    row.focus();
    setReveal(null);
  });

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenuAt = (e: MouseEvent, key: string, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(key);
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const openMenuForElement = (el: HTMLElement, key: string, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    setSelected(key);
    setMenu({ x: r.left + 24, y: r.bottom, items });
  };

  /** Menú debajo de un botón (sin seleccionar ninguna fila). */
  const openMenuBelow = (el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };

  // Navegación con flechas entre filas.
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isNavKey(e.key)) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sb-row]") ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const next = navIndex(e.key, rows.indexOf(document.activeElement as HTMLElement), rows.length);
    rows[next].focus();
    rows[next].scrollIntoView({ block: "nearest" });
  };

  /** `onEnter` recibe true con Ctrl/⌘+Enter (en un servidor: abrir otra conexión). */
  const rowKeys = (
    e: KeyboardEvent<HTMLElement>,
    onEnter: (withMod: boolean) => void,
    key: string,
    items: () => MenuItem[],
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter(isModKey(e));
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openMenuForElement(e.currentTarget, key, items());
    }
  };

  return {
    selected,
    setSelected,
    menu,
    closeMenu,
    setReveal,
    listRef,
    openMenuAt,
    openMenuForElement,
    openMenuBelow,
    onListKeyDown,
    rowKeys,
  };
}

export type SidebarTree = ReturnType<typeof useSidebarTree>;
