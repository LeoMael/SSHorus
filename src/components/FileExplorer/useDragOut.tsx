// Arrastrar filas al sistema (escritorio / gestor de archivos): se descargan primero a una caché.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { transfers } from "../../api/transfers";
import { isApiError } from "../../api/core";
import type { FileEntry } from "../../api/types";
import { formatBytes } from "../../lib/format";
import { toast } from "../../stores/toasts";
import { confirmDialog } from "../ui/dialogs";
import { sessionOnline } from "./connection";
import { BIG_DRAG_BYTES, DragOutCanceled, forgetPrepared, prepareDragOut, readyPaths, startDragOut } from "./dragOut";
import { filesBytes, itemsLabel } from "./explorerLogic";
import { useEvent } from "./useEvent";

/** Píxeles que hay que mover el ratón con el botón apretado para empezar a arrastrar al sistema. */
const DRAG_START_PX = 6;

interface DragOutOpts {
  sessionId: string;
  rows: FileEntry[];
  selectedRef: RefObject<Set<string>>;
  selectOnly: (path: string) => void;
  focusRoot: () => void;
}

export function useDragOut({ sessionId, rows, selectedRef, selectOnly, focusRoot }: DragOutOpts) {
  /** Descarga a la caché en curso para arrastrar al sistema. */
  const [dragPrep, setDragPrep] = useState<{ batchId: string | null; label: string } | null>(null);
  // Dónde se apretó el botón, si sigue apretado y qué fila reducir al soltar.
  const pressRef = useRef<{ x: number; y: number; entry: FileEntry } | null>(null);
  const heldRef = useRef(false);
  const pressSeqRef = useRef(0);
  const deferSelectRef = useRef<string | null>(null);

  const notePress = useEvent((e: ReactMouseEvent, entry: FileEntry) => {
    pressRef.current = { x: e.clientX, y: e.clientY, entry };
    heldRef.current = true;
    pressSeqRef.current++;
  });

  /** Arrastre nativo de lo ya preparado. Si la caché se borró, vuelve a prepararlo una vez. */
  const runDragOut = useEvent(async (paths: string[], items: FileEntry[], retry: boolean): Promise<void> => {
    try {
      await startDragOut(paths);
    } catch (err) {
      if (isApiError(err, "NotFound")) {
        forgetPrepared(sessionId, items);
        if (retry) await beginDragOut(items, false);
        else toast.info("Lo preparado ya no está", "Vuelve a arrastrarlo para descargarlo otra vez.");
      } else {
        toast.error("No se pudo arrastrar", err);
      }
    } finally {
      heldRef.current = false;
    }
  });

  /** Empieza a arrastrar `items` fuera de la app: inmediato si ya están descargados; si no, los
   *  descarga a la caché (con progreso) y arrastra al terminar si el botón sigue apretado. */
  const beginDragOut = useEvent(async (items: FileEntry[], retry: boolean = true): Promise<void> => {
    if (!sessionOnline(sessionId)) return;
    const list = items.filter((e) => e.kind !== "other");
    if (!list.length) return;
    const ready = readyPaths(sessionId, list);
    if (ready) {
      await runDragOut(ready, list, retry);
      return;
    }
    if (dragPrep) {
      toast.info("Ya se está preparando otro arrastre", "Espera a que termine o cancélalo abajo.");
      return;
    }
    const label = itemsLabel(list.length, list[0].name);
    const bytes = filesBytes(list);
    if (bytes > BIG_DRAG_BYTES) {
      heldRef.current = false;
      const ok = await confirmDialog({
        title: `¿Preparar ${label} para arrastrar?`,
        message: (
          <>
            <div>
              Ocupa {formatBytes(bytes)}. Para poder arrastrarlo, SSHorus primero lo descarga a una carpeta temporal
              (se ve en Transferencias) y después lo copias a donde lo sueltes.
            </div>
            <div>Para archivos grandes es más rápido «Descargar en…» (clic derecho).</div>
          </>
        ),
        confirmText: "Preparar",
      });
      focusRoot();
      if (!ok) return;
    }
    const seq = pressSeqRef.current;
    setDragPrep({ batchId: null, label });
    try {
      const paths = await prepareDragOut(sessionId, list, (batchId) => setDragPrep({ batchId, label }));
      setDragPrep(null);
      // Sigue apretado desde el mismo clic: se arrastra ya. Si no, queda listo para el próximo.
      if (heldRef.current && pressSeqRef.current === seq && sessionOnline(sessionId)) {
        await runDragOut(paths, list, false);
      } else {
        toast.success(`Listo para arrastrar ${label}`, "Vuelve a arrastrarlo al escritorio o a una carpeta.");
      }
    } catch (err) {
      if (!(err instanceof DragOutCanceled)) toast.error("No se pudo preparar el arrastre", err);
    } finally {
      setDragPrep(null);
    }
  });

  const cancelDragPrep = useEvent(() => {
    if (dragPrep?.batchId) transfers.cancel([dragPrep.batchId]).catch(() => {});
  });

  // Seguimiento del ratón tras apretar en una fila: pasado el umbral empieza el arrastre.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = pressRef.current;
      if (!p) return;
      if (!(e.buttons & 1)) {
        pressRef.current = null;
        return;
      }
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < DRAG_START_PX) return;
      pressRef.current = null;
      deferSelectRef.current = null;
      const sel = selectedRef.current;
      const items = sel.has(p.entry.path) ? rows.filter((r) => sel.has(r.path)) : [p.entry];
      beginDragOut(items);
    };
    const up = () => {
      heldRef.current = false;
      const defer = deferSelectRef.current;
      if (pressRef.current && defer) selectOnly(defer);
      pressRef.current = null;
      deferSelectRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [rows, beginDragOut, selectOnly]);

  return { dragPrep, notePress, cancelDragPrep, deferSelectRef };
}
