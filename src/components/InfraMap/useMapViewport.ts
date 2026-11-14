// Zoom y desplazamiento del lienzo del mapa: rueda (zoom hacia el puntero), pellizco del touchpad,
// arrastrar para mover y teclado (+ / − / 0, también con Ctrl). La matemática está en
// features/infra/viewport.ts; aquí solo los eventos.
//
// Ctrl+rueda y Ctrl + «+»/«−»/«0» sobre el mapa no deben llegar al zoom de la ventana: la rueda se
// escucha con `passive: false` y se cancela; las teclas, en `window` en fase de captura, antes que nadie.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { isMac } from "../../lib/platform";
import { SHORTCUT_ACTIONS } from "../../features/shortcuts/keys";
import { matchesShortcut } from "../../features/shortcuts/shortcuts";
import {
  centerOn,
  fitView,
  pan,
  wheelIntent,
  wheelPan,
  wheelZoomFactor,
  zoomAt,
  zoomKey,
  zoomStep,
  type Size,
  type Viewport,
  type ZoomKey,
} from "../../features/infra/viewport";

interface Options {
  /** Tamaño del contenido (null mientras no hay mapa). */
  content: { width: number; height: number } | null;
  /** Clic sin arrastrar: id del nodo (atributo `data-node`) o null si fue en el fondo. */
  onClick: (node: string | null) => void;
  onEscape?: () => void;
}

export function useMapViewport({ content, onClick, onEscape }: Options) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState<Size>({ w: 800, h: 500 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** El usuario movió la vista: no reajustar al cambiar el tamaño del panel. */
  const touched = useRef(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);

  const contentRef = useRef(content);
  contentRef.current = content;
  const fit = useCallback(() => {
    const c = contentRef.current;
    if (!c) return;
    touched.current = false;
    setView(fitView(c, sizeRef.current));
  }, []);
  const change = useCallback((f: (v: Viewport) => Viewport) => {
    touched.current = true;
    setView(f);
  }, []);
  const zoomIn = useCallback(() => change((v) => zoomStep(v, 1, sizeRef.current)), [change]);
  const zoomOut = useCallback(() => change((v) => zoomStep(v, -1, sizeRef.current)), [change]);
  const center = useCallback((mx: number, my: number) => change((v) => centerOn(v, mx, my, sizeRef.current)), [change]);
  const act = useCallback((z: ZoomKey) => (z === "in" ? zoomIn() : z === "out" ? zoomOut() : fit()), [zoomIn, zoomOut, fit]);

  // Ajustar al cambiar el contenido, y al cambiar el tamaño mientras el usuario no haya movido la vista.
  const fitKey = content ? `${content.width}x${content.height}` : "";
  const lastFit = useRef("");
  useEffect(() => {
    if (!fitKey || size.w < 50) return;
    const key = touched.current ? fitKey : `${fitKey}|${size.w}x${size.h}`;
    if (lastFit.current === key) return;
    lastFit.current = key;
    fit();
  }, [fitKey, fit, size.w, size.h]);

  // Rueda, pellizco (llega como rueda con Ctrl) y gestos de WebKit en macOS.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const h = sizeRef.current.h;
      if (wheelIntent(e) === "zoom") {
        const [cx, cy] = local(e);
        const f = wheelZoomFactor(e, h);
        change((v) => zoomAt(v, f, cx, cy));
      } else {
        const { dx, dy } = wheelPan(e, h);
        change((v) => pan(v, dx, dy));
      }
    };
    // Rueda antigua (algunos WebKit la mandan además): solo cancelarla.
    const onLegacy = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    let gestureK = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureK = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!g.scale) return;
      const f = g.scale / gestureK;
      gestureK = g.scale;
      const [cx, cy] = g.clientX != null ? local(g as { clientX: number; clientY: number }) : [sizeRef.current.w / 2, sizeRef.current.h / 2];
      change((v) => zoomAt(v, f, cx, cy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousewheel", onLegacy, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onLegacy, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousewheel", onLegacy);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onLegacy);
    };
  }, [change]);

  // Ctrl + «+» / «−» / «0» con el mapa visible (aunque el foco esté en la barra de herramientas).
  const hoverAt = useRef(0);
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const entry: MapEntry = { el: () => wrapRef.current, act: (z) => actRef.current(z), hoverAt };
    return registerMap(entry);
  }, []);

  // Arrastrar para mover (botón izquierdo o central); un clic sin moverse selecciona.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; node: string | null; button: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault(); // sin el desplazamiento automático del botón central
    const t = (e.target as Element).closest("[data-node]");
    const v = viewRef.current;
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false, node: t ? t.getAttribute("data-node") : null, button: e.button };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* eventos sintéticos (vista previa) */
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    hoverAt.current = performance.now();
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) change((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && d.button === 0) onClick(d.node);
  };
  const onPointerCancel = () => {
    drag.current = null;
  };
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === "Escape") {
      onEscape?.();
      return;
    }
    // Con el foco en el mapa basta la tecla sola; con Ctrl ya lo atendió el oyente global.
    const z = zoomKey(e, isMac, false);
    if (!z) return;
    e.preventDefault();
    e.stopPropagation();
    act(z);
  };

  return {
    wrapRef,
    view,
    size,
    zoomIn,
    zoomOut,
    fit,
    center,
    canvasProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
  };
}

// ───────── Oyente global de teclado (uno para todos los mapas montados) ─────────

interface MapEntry {
  el: () => HTMLElement | null;
  act: (z: ZoomKey) => void;
  hoverAt: { current: number };
}

const maps = new Set<MapEntry>();

function registerMap(m: MapEntry): () => void {
  if (maps.size === 0) window.addEventListener("keydown", onGlobalKey, true);
  maps.add(m);
  return () => {
    maps.delete(m);
    if (maps.size === 0) window.removeEventListener("keydown", onGlobalKey, true);
  };
}

const EDITABLE = "input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable='true'], .xterm, .monaco-editor";

/** Mapa que se queda el atajo: el que tiene el foco; si no, el de un diálogo, o el último bajo el ratón. */
function pickMap(): MapEntry | null {
  const modal = document.querySelector(".modal-backdrop");
  const visible = [...maps].filter((m) => {
    const el = m.el();
    return !!el && el.isConnected && el.getClientRects().length > 0 && (!modal || modal.contains(el));
  });
  if (visible.length === 0) return null;
  const active = document.activeElement;
  const focused = visible.find((m) => active && m.el()!.contains(active));
  if (focused) return focused;
  // Escribiendo en un campo, la terminal o el editor: Ctrl + «−» es suyo.
  if (active instanceof HTMLElement && active.closest(EDITABLE)) return null;
  const score = (m: MapEntry) => (m.el()!.closest("[aria-modal='true']") ? 1e15 : 0) + m.hoverAt.current;
  return visible.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function onGlobalKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const z = zoomKey(e, isMac, true);
  if (!z) return;
  // Un atajo de la app configurado con esa combinación tiene prioridad.
  if (SHORTCUT_ACTIONS.some((a) => a.scope === "global" && matchesShortcut(a.id, e))) return;
  const m = pickMap();
  if (!m) return;
  e.preventDefault();
  e.stopPropagation();
  m.act(z);
}
