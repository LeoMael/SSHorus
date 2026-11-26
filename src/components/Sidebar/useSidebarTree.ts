// Árbol de la barra lateral: fila seleccionada, menú contextual abierto, teclado y «mostrar fila».
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { isModKey } from "../../lib/platform";
import type { MenuItem } from "../ui/ContextMenu";
import { isNavKey, navIndex } from "./sidebarLogic";

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Si la fila pedida no aparece en este tiempo (p. ej. el servidor se borró), se deja de buscar. */
const REVEAL_GIVE_UP_MS = 3000;

export function useSidebarTree() {
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Fila que hay que mostrar (desplazar y enfocar) en cuanto aparezca, p. ej. un servidor recién añadido. */
  const revealRef = useRef<string | null>(null);
  const giveUpRef = useRef<number | undefined>(undefined);
  const [, forceRender] = useState(0);

  const setReveal = useCallback((key: string) => {
    revealRef.current = key;
    window.clearTimeout(giveUpRef.current);
    // Si la fila no llega a aparecer (p. ej. el servidor se borró), se deja de buscar: así no roba el
    // foco mucho después.
    giveUpRef.current = window.setTimeout(() => {
      if (revealRef.current === key) revealRef.current = null;
    }, REVEAL_GIVE_UP_MS);
    forceRender((n) => n + 1);
  }, []);

  useEffect(() => () => window.clearTimeout(giveUpRef.current), []);

  // Sin lista de dependencias a propósito: la fila puede aparecer varios renders después (se guarda el
  // servidor, se despliega su proyecto, se borra la búsqueda) y cualquiera de ellos puede ser el bueno.
  // Sin nada pendiente sale enseguida, así que no cuesta nada.
  useEffect(() => {
    const key = revealRef.current;
    if (!key) return;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sb-key]") ?? []).find(
      (el) => el.dataset.sbKey === key,
    );
    if (!row) return; // aún no está en la lista: se reintenta en el siguiente render
    revealRef.current = null;
    window.clearTimeout(giveUpRef.current);
    row.scrollIntoView({ block: "nearest" });
    row.focus();
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
