// Pellizco del touchpad que el motor captura en Linux (WebKitGTK no lo deja llegar a la página) y
// reenvía como el evento `pinch-zoom` (src-tauri/src/pinch.rs). Un solo oyente para todos los mapas;
// cada mapa decide si el gesto es suyo (el puntero está encima).
import { useEffect, useRef, type RefObject } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pinchStep } from "../../features/infra/viewport";

interface PinchPayload {
  phase: "begin" | "update" | "end";
  /** Escala acumulada desde el comienzo del gesto. */
  scale: number;
}

type Handler = (factor: number) => void;

const handlers = new Set<Handler>();
let unlisten: Promise<UnlistenFn> | null = null;
let last = 1;

function onPayload({ phase, scale }: PinchPayload): void {
  if (phase !== "update") {
    last = 1;
    return;
  }
  const f = pinchStep(last, scale);
  last = scale;
  if (f !== 1) for (const h of handlers) h(f);
}

function subscribe(h: Handler): () => void {
  handlers.add(h);
  if (!unlisten) {
    try {
      unlisten = listen<PinchPayload>("pinch-zoom", (e) => onPayload(e.payload)).catch(() => () => {});
    } catch {
      unlisten = Promise.resolve(() => {}); // fuera de Tauri (vista previa en el navegador)
    }
  }
  return () => {
    handlers.delete(h);
    if (handlers.size === 0 && unlisten) {
      void unlisten.then((u) => u());
      unlisten = null;
    }
  };
}

/**
 * Zoom con el pellizco nativo mientras el puntero está sobre `el`, hacia la última posición del
 * puntero (coordenadas de pantalla) o, si no se conoce, hacia el centro.
 */
export function useNativePinch(
  el: RefObject<HTMLElement | null>,
  pointer: RefObject<{ x: number; y: number } | null>,
  zoom: (factor: number, cx: number, cy: number) => void,
): void {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(
    () =>
      subscribe((f) => {
        const node = el.current;
        if (!node || !node.matches(":hover")) return;
        const r = node.getBoundingClientRect();
        const p = pointer.current;
        zoomRef.current(f, p ? p.x - r.left : r.width / 2, p ? p.y - r.top : r.height / 2);
      }),
    [el, pointer],
  );
}
