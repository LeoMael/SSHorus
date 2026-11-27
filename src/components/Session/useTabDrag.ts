// Arrastrar pestañas de archivo: reordenar dentro de la barra o despegar a una ventana aparte.
// Con eventos de puntero: el arrastre HTML5 lo intercepta Tauri (y en WebKitGTK falla).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as RPointerEvent,
  type SetStateAction,
} from "react";
import type { WindowAt } from "../Editor/editorWindows";
import { moveItem } from "./workArea";
import { isCompareKey } from "../../features/compare";

/** Distancia (px) por debajo/encima de la barra a partir de la cual la pestaña «se despega» (como en Chrome). */
const DETACH_MARGIN = 60;
/** Movimiento mínimo (px) para que pulsar una pestaña cuente como arrastre. */
const DRAG_THRESHOLD = 5;

/** Arrastre en curso de la pestaña de un archivo. */
interface TabDrag {
  path: string;
  pointerId: number;
  el: HTMLElement;
  bar: HTMLElement;
  /** Punto de inicio (cliente) y distancia del cursor al borde izquierdo de la pestaña. */
  x0: number;
  y0: number;
  grabX: number;
  moved: boolean;
  /** Fuera de la barra: al soltar se abre en ventana aparte. */
  out: boolean;
  /** Última posición conocida (por si el sistema no entrega el «soltar»). */
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface TabDragOpts {
  files: string[];
  setFiles: Dispatch<SetStateAction<string[]>>;
  showFile: (path: string) => void;
  connected: boolean;
  detachFile: (path: string, at?: WindowAt) => Promise<void>;
}

export type TabDragApi = ReturnType<typeof useTabDrag>;

export function useTabDrag({ files, setFiles, showFile, connected, detachFile }: TabDragOpts) {
  const drag = useRef<TabDrag | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  /** Archivo «despegado» (fuera de la barra): se dibuja un fantasma que sigue al cursor. */
  const [ghostPath, setGhostPath] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  /** Coloca la pestaña arrastrada bajo el cursor (desplazamiento visual, sin salir de las pestañas de archivo). */
  const placeDragged = useCallback(() => {
    const d = drag.current;
    if (!d?.moved) return;
    const g = ghostRef.current;
    if (g) {
      // Posición directa en el DOM: sin volver a dibujar la sesión entera en cada movimiento.
      g.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, d.clientX))}px`;
      g.style.top = `${Math.max(0, Math.min(window.innerHeight - 24, d.clientY))}px`;
    }
    if (d.out) {
      d.el.style.transform = "";
      return;
    }
    const tabs = Array.from(d.bar.querySelectorAll<HTMLElement>("[data-file-tab]"));
    if (tabs.length === 0) return;
    // offsetLeft es la posición sin el desplazamiento visual; se pasa a coordenadas de la barra visible.
    const scroll = d.bar.scrollLeft;
    const natural = d.el.offsetLeft - scroll;
    const minLeft = Math.min(...tabs.map((t) => t.offsetLeft)) - scroll;
    const maxLeft = Math.max(...tabs.map((t) => t.offsetLeft + t.offsetWidth)) - d.el.offsetWidth - scroll;
    const want = d.clientX - d.grabX - d.bar.getBoundingClientRect().left;
    const left = Math.max(minLeft, Math.min(maxLeft, want));
    d.el.style.transform = `translateX(${Math.round(left - natural)}px)`;
  }, []);

  // Tras reordenar (la pestaña cambió de sitio en el DOM) o al despegarse: recolocar.
  useLayoutEffect(() => placeDragged(), [files, ghostPath, placeDragged]);

  const endDrag = useCallback((drop: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.el.style.transform = "";
    setDragPath(null);
    setGhostPath(null);
    if (drop && d.moved && d.out) {
      void detachFile(d.path, { screenX: d.screenX, screenY: d.screenY });
    }
  }, [detachFile]);

  // Esc cancela el arrastre.
  useEffect(() => {
    if (!dragPath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragPath, endDrag]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>, path: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".sv-tab-close")) return;
    const el = e.currentTarget;
    const bar = el.parentElement;
    if (!bar) return;
    showFile(path);
    drag.current = {
      path,
      pointerId: e.pointerId,
      el,
      bar,
      x0: e.clientX,
      y0: e.clientY,
      grabX: e.clientX - el.getBoundingClientRect().left,
      moved: false,
      out: false,
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
    };
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    d.screenX = e.screenX;
    d.screenY = e.screenY;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD) return;
      d.moved = true;
      try {
        d.el.setPointerCapture(d.pointerId);
      } catch {
        /* el puntero ya se soltó */
      }
      setDragPath(d.path);
    }
    const r = d.bar.getBoundingClientRect();
    const outside =
      e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
    // Una comparación no se abre en otra ventana: solo se reordena.
    d.out = connected && !isCompareKey(d.path) && (outside || e.clientY > r.bottom + DETACH_MARGIN || e.clientY < r.top - DETACH_MARGIN);
    setGhostPath(d.out ? d.path : null);
    if (d.out) {
      placeDragged();
      return;
    }
    // Reordenar: cambiar de sitio con la pestaña bajo el cursor cuando, tras el cambio, el cursor seguiría
    // encima de la arrastrada (así no rebota entre pestañas de distinto ancho).
    const w = d.el.offsetWidth;
    const tabs = Array.from(d.bar.querySelectorAll<HTMLElement>("[data-file-tab]"));
    for (const t of tabs) {
      if (t === d.el) continue;
      const tr = t.getBoundingClientRect();
      if (e.clientX < tr.left || e.clientX >= tr.right) continue;
      const after = t.offsetLeft > d.el.offsetLeft;
      const swap = after ? e.clientX >= tr.right - w : e.clientX <= tr.left + w;
      const target = t.dataset.fileTab;
      if (swap && target) setFiles((f) => moveItem(f, d.path, target));
      break;
    }
    placeDragged();
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.screenX = e.screenX;
    d.screenY = e.screenY;
    endDrag(true);
  };

  // Si el sistema retira el puntero sin «soltar» (p. ej. al salir de la ventana), vale la última posición.
  const onLostCapture = () => endDrag(true);
  const onPointerCancel = () => endDrag(false);

  return { dragPath, ghostPath, ghostRef, onPointerDown, onPointerMove, onPointerUp, onLostCapture, onPointerCancel };
}
