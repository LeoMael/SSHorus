// Teclado del explorador: atajos configurables, movimiento del cursor y búsqueda rápida por nombre.
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";
import type { FileEntry } from "../../api/types";
import { matchesShortcut } from "../../features/shortcuts/shortcuts";
import { HEADER_H, ROW_H } from "./FileList";
import { typeAheadIndex } from "./explorerLogic";

export interface ExplorerKeyCtx {
  active: boolean;
  offline: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  filterRef: RefObject<HTMLInputElement | null>;
  typeAheadRef: RefObject<{ text: string; at: number }>;
  filter: string;
  setFilter: (v: string) => void;
  setEditingPath: (v: boolean) => void;
  rows: FileEntry[];
  indexOf: Map<string, number>;
  cursor: string | null;
  selected: Set<string>;
  selectedEntries: FileEntry[];
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  moveCursor: (index: number, shift: boolean, ctrl: boolean) => void;
  refresh: () => void;
  goUp: () => void;
  goBack: () => void;
  goForward: () => void;
  openEntry: (e: FileEntry) => void;
  rename: (e: FileEntry) => void;
  remove: (list: FileEntry[]) => void;
}

export function handleExplorerKey(e: ReactKeyboardEvent<HTMLDivElement>, c: ExplorerKeyCtx) {
  if (!c.active || c.offline) return;
  const t = e.target as HTMLElement;
  // Teclas dentro de un diálogo (permisos, etc.) no son para la lista.
  if (t.closest(".modal-backdrop")) return;
  const inInput = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const ev = e.nativeEvent;
  const { rows, cursor } = c;

  // Atajos configurables (Ajustes → Atajos de teclado). Estos tres valen también en el filtro.
  if (matchesShortcut("explorer.path", ev)) {
    e.preventDefault();
    c.setEditingPath(true);
    return;
  }
  if (matchesShortcut("explorer.filter", ev)) {
    e.preventDefault();
    c.filterRef.current?.focus();
    c.filterRef.current?.select();
    return;
  }
  if (matchesShortcut("explorer.refresh", ev)) {
    e.preventDefault();
    c.refresh();
    return;
  }
  // Con un botón enfocado, Intro/Espacio activan el botón (no la fila).
  if ((key === "Enter" || key === " ") && t !== c.rootRef.current && t.closest("button, a, select")) return;
  if (inInput) {
    if (key === "Escape" && t === c.filterRef.current) {
      e.preventDefault();
      if (c.filter) c.setFilter("");
      else c.rootRef.current?.focus();
    } else if (key === "ArrowDown" && t === c.filterRef.current) {
      e.preventDefault();
      c.rootRef.current?.focus();
      c.moveCursor(0, false, false);
    }
    return;
  }

  const cur = cursor ? (c.indexOf.get(cursor) ?? -1) : -1;
  const page = Math.max(1, Math.floor(((c.listRef.current?.clientHeight ?? 300) - HEADER_H) / ROW_H) - 1);
  const curEntry = cur >= 0 ? rows[cur] : c.selectedEntries.length === 1 ? c.selectedEntries[0] : undefined;

  const action = (
    [
      ["explorer.up", c.goUp],
      ["explorer.back", c.goBack],
      ["explorer.forward", c.goForward],
      ["explorer.selectAll", () => c.setSelected(new Set(rows.map((r) => r.path)))],
      ["explorer.delete", () => c.remove(c.selectedEntries)],
      ["explorer.rename", () => curEntry && c.rename(curEntry)],
    ] as [string, () => void][]
  ).find(([id]) => matchesShortcut(id, ev));
  if (action) {
    e.preventDefault();
    action[1]();
    return;
  }
  if (e.altKey) return;

  switch (key) {
    case "ArrowDown":
      c.moveCursor(cur + 1, e.shiftKey, mod);
      break;
    case "ArrowUp":
      c.moveCursor(cur < 0 ? rows.length - 1 : cur - 1, e.shiftKey, mod);
      break;
    case "PageDown":
      c.moveCursor(cur + page, e.shiftKey, mod);
      break;
    case "PageUp":
      c.moveCursor(cur - page, e.shiftKey, mod);
      break;
    case "Home":
      c.moveCursor(0, e.shiftKey, mod);
      break;
    case "End":
      c.moveCursor(rows.length - 1, e.shiftKey, mod);
      break;
    case " ":
      if (!mod || !cursor) return;
      c.setSelected((s) => {
        const n = new Set(s);
        if (n.has(cursor)) n.delete(cursor);
        else n.add(cursor);
        return n;
      });
      break;
    case "Enter":
      if (!curEntry) return;
      c.openEntry(curEntry);
      break;
    case "Backspace":
      c.goUp();
      break;
    case "Escape":
      if (!c.selected.size) return;
      c.setSelected(new Set());
      break;
    default:
      // Búsqueda rápida escribiendo el nombre.
      if (key.length === 1 && !mod && key !== " ") {
        const now = Date.now();
        const ta = c.typeAheadRef.current;
        ta.text = now - ta.at < 800 ? ta.text + key.toLowerCase() : key.toLowerCase();
        ta.at = now;
        const i = typeAheadIndex(rows, cur, ta.text);
        if (i >= 0) c.moveCursor(i, false, false);
        break;
      }
      return;
  }
  e.preventDefault();
}
