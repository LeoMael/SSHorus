// Ratón sobre la lista: clic (con Mayús/Ctrl), doble clic, menú contextual y clic en el vacío.
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { FileEntry } from "../../api/types";
import { sessionOnline } from "./connection";
import type { RowHandlers } from "./FileList";
import type { SelectionState } from "./useSelection";

export interface MenuAt {
  x: number;
  y: number;
  onEntry: boolean;
}

interface RowHandlersOpts {
  sessionId: string;
  sel: SelectionState;
  rootRef: RefObject<HTMLDivElement | null>;
  setMenu: (m: MenuAt) => void;
  selectOnly: (path: string) => void;
  selectRange: (to: string, additive: boolean) => void;
  openEntry: (e: FileEntry) => void;
  notePress: (e: ReactMouseEvent, entry: FileEntry) => void;
  /** Fila a la que reducir la selección al soltar sin haber arrastrado. */
  deferSelectRef: RefObject<string | null>;
}

export function useRowHandlers({
  sessionId,
  sel,
  rootRef,
  setMenu,
  selectOnly,
  selectRange,
  openEntry,
  notePress,
  deferSelectRef,
}: RowHandlersOpts) {
  const { setSelected, setCursor, anchorRef, selectedRef } = sel;

  const handlers: RowHandlers = useMemo(
    () => ({
      onMouseDown: (e: ReactMouseEvent, entry: FileEntry) => {
        if (e.button !== 0) return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.shiftKey) {
          e.preventDefault();
          selectRange(entry.path, mod);
        } else if (mod) {
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(entry.path)) n.delete(entry.path);
            else n.add(entry.path);
            return n;
          });
          setCursor(entry.path);
          anchorRef.current = entry.path;
        } else if (selectedRef.current.has(entry.path) && selectedRef.current.size > 1) {
          // Puede ser el inicio de un arrastre de toda la selección: se reduce a esta fila
          // al soltar sin haber arrastrado.
          setCursor(entry.path);
          anchorRef.current = entry.path;
          deferSelectRef.current = entry.path;
        } else {
          selectOnly(entry.path);
        }
        if (!e.shiftKey && !mod) notePress(e, entry);
      },
      onDoubleClick: (entry: FileEntry) => {
        if (sessionOnline(sessionId)) openEntry(entry);
      },
      onContextMenu: (e: ReactMouseEvent, entry: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!sessionOnline(sessionId)) return;
        setSelected((s) => {
          if (s.has(entry.path)) return s;
          anchorRef.current = entry.path;
          return new Set([entry.path]);
        });
        setCursor(entry.path);
        rootRef.current?.focus({ preventScroll: true });
        setMenu({ x: e.clientX, y: e.clientY, onEntry: true });
      },
    }),
    [
      anchorRef,
      deferSelectRef,
      notePress,
      openEntry,
      rootRef,
      selectedRef,
      selectOnly,
      selectRange,
      sessionId,
      setCursor,
      setMenu,
      setSelected,
    ],
  );

  const onEmptyMouseDown = useCallback(() => {
    setSelected(new Set());
    setCursor(null);
    anchorRef.current = null;
  }, [anchorRef, setCursor, setSelected]);

  const onEmptyContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      if (!sessionOnline(sessionId)) return;
      onEmptyMouseDown();
      rootRef.current?.focus({ preventScroll: true });
      setMenu({ x: e.clientX, y: e.clientY, onEntry: false });
    },
    [onEmptyMouseDown, rootRef, sessionId, setMenu],
  );

  return { handlers, onEmptyMouseDown, onEmptyContextMenu };
}
