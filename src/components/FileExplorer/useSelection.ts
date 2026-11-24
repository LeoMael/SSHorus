// Selección de filas: qué está elegido, dónde está el cursor y cómo se mueve.
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { FileEntry } from "../../api/types";
import { HEADER_H, ROW_H } from "./FileList";
import { rangePaths } from "./explorerLogic";
import { useEvent } from "./useEvent";

export interface SelectionState {
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  cursor: string | null;
  setCursor: Dispatch<SetStateAction<string | null>>;
  /** Fila desde la que se extiende una selección con Mayús. */
  anchorRef: RefObject<string | null>;
  /** Lo seleccionado, para leerlo desde manejadores de ventana sin volver a registrarlos. */
  selectedRef: RefObject<Set<string>>;
  /** Fila a la que desplazarse cuando aparezca en la lista. */
  scrollToRef: RefObject<string | null>;
}

export function useSelectionState(): SelectionState {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const scrollToRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  return { selected, setSelected, cursor, setCursor, anchorRef, selectedRef, scrollToRef };
}

export function useSelectionOps(
  sel: SelectionState,
  rows: FileEntry[],
  indexOf: Map<string, number>,
  listRef: RefObject<HTMLDivElement | null>,
) {
  const { setSelected, setCursor, anchorRef, scrollToRef } = sel;

  const scrollToIndex = useCallback(
    (i: number) => {
      const el = listRef.current;
      if (!el || i < 0) return;
      const top = i * ROW_H;
      const minTop = HEADER_H + (i + 1) * ROW_H - el.clientHeight;
      if (el.scrollTop > top) el.scrollTop = top;
      else if (el.scrollTop < minTop) el.scrollTop = minTop;
    },
    [listRef],
  );

  useEffect(() => {
    const p = scrollToRef.current;
    if (!p) return;
    const i = indexOf.get(p);
    if (i !== undefined) {
      scrollToRef.current = null;
      requestAnimationFrame(() => scrollToIndex(i));
    }
  }, [indexOf, scrollToIndex, scrollToRef]);

  const selectOnly = useCallback(
    (path: string) => {
      setSelected(new Set([path]));
      setCursor(path);
      anchorRef.current = path;
    },
    [anchorRef, setCursor, setSelected],
  );

  const selectRange = useEvent((to: string, additive: boolean) => {
    const from = anchorRef.current ?? to;
    const a = indexOf.get(from) ?? indexOf.get(to) ?? 0;
    const b = indexOf.get(to) ?? 0;
    const range = rangePaths(rows, a, b);
    setSelected((s) => (additive ? new Set([...s, ...range]) : new Set(range)));
    setCursor(to);
  });

  const moveCursor = useEvent((index: number, shift: boolean, ctrl: boolean) => {
    if (!rows.length) return;
    const i = Math.max(0, Math.min(rows.length - 1, index));
    const p = rows[i].path;
    if (shift) selectRange(p, ctrl);
    else if (ctrl) setCursor(p);
    else selectOnly(p);
    scrollToIndex(i);
  });

  return { selectOnly, selectRange, moveCursor };
}
