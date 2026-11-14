// Vista del mapa de infraestructura: matemática pura del zoom y el desplazamiento (sin DOM).
// La vista es `translate(x, y) scale(k)` sobre el contenido del SVG: un punto del mapa (mx, my)
// se ve en pantalla en (x + mx·k, y + my·k).

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Límites del zoom (20 % – 400 %). */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
/** Paso de los botones y del teclado. */
export const ZOOM_STEP = 1.2;
/** «Ajustar» no amplía más que esto (un mapa pequeño no se ve gigante). */
export const FIT_MAX_ZOOM = 1.25;

export function clampZoom(k: number): number {
  if (!Number.isFinite(k)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Zoom multiplicando por `factor` sin mover el punto de pantalla (cx, cy). Respeta los límites. */
export function zoomAt(v: Viewport, factor: number, cx: number, cy: number): Viewport {
  const k = clampZoom(v.k * factor);
  if (k === v.k) return v;
  const f = k / v.k;
  return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
}

/** Zoom con un paso (+1 acercar, −1 alejar) hacia el centro de la pantalla. */
export function zoomStep(v: Viewport, dir: 1 | -1, size: Size): Viewport {
  return zoomAt(v, dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, size.w / 2, size.h / 2);
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return dx === 0 && dy === 0 ? v : { ...v, x: v.x + dx, y: v.y + dy };
}

/** Coloca el punto del mapa (mx, my) en el centro de la pantalla, sin cambiar el zoom. */
export function centerOn(v: Viewport, mx: number, my: number, size: Size): Viewport {
  return { k: v.k, x: size.w / 2 - mx * v.k, y: size.h / 2 - my * v.k };
}

/** Vista que enseña todo el contenido (ancho × alto) centrado, con un margen alrededor. */
export function fitView(content: { width: number; height: number }, size: Size, margin = 16): Viewport {
  const cw = Math.max(1, content.width);
  const ch = Math.max(1, content.height);
  const aw = Math.max(1, size.w - margin * 2);
  const ah = Math.max(1, size.h - margin * 2);
  const k = clampZoom(Math.min(FIT_MAX_ZOOM, aw / cw, ah / ch));
  return { k, x: (size.w - cw * k) / 2, y: Math.max(0, (size.h - ch * k) / 2) };
}

/** Porcentaje para mostrar ("125 %" → 125). */
export function zoomPercent(k: number): number {
  return Math.round(k * 100);
}

// ───────── Rueda y pellizco ─────────

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 = píxeles, 1 = líneas, 2 = páginas. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const LINE_PX = 16;

/** Desplazamiento de la rueda en píxeles, sea cual sea su unidad. */
export function wheelPixels(e: WheelLike, pageH: number): { dx: number; dy: number } {
  const m = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? Math.max(1, pageH) : 1;
  return { dx: e.deltaX * m, dy: e.deltaY * m };
}

/**
 * ¿La rueda hace zoom o desplaza? Con Ctrl/⌘ (y el pellizco del touchpad, que llega así) siempre
 * zoom; Mayús o un gesto sobre todo horizontal desplazan; la rueda vertical normal hace zoom.
 */
export function wheelIntent(e: WheelLike): "zoom" | "pan" {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (e.shiftKey) return "pan";
  return Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 ? "zoom" : "pan";
}

/**
 * Factor de zoom de un evento de rueda. El pellizco del touchpad manda pasos pequeños con Ctrl, así
 * que se amplifica; una muesca de rueda (~100 px) cambia el zoom ~16 %. Cada evento queda acotado.
 */
export function wheelZoomFactor(e: WheelLike, pageH: number): number {
  const { dy } = wheelPixels(e, pageH);
  const pinch = (e.ctrlKey || e.metaKey) && e.deltaMode === 0 && Math.abs(dy) < 50;
  const f = Math.exp(-dy * (pinch ? 0.01 : 0.0018));
  return Math.min(1.5, Math.max(1 / 1.5, f));
}

/** Desplazamiento (en píxeles de pantalla) de un evento de rueda que no hace zoom. */
export function wheelPan(e: WheelLike, pageH: number): { dx: number; dy: number } {
  const { dx, dy } = wheelPixels(e, pageH);
  // Con Mayús la rueda vertical desplaza en horizontal (como en los navegadores).
  if (e.shiftKey && dx === 0) return { dx: -dy, dy: 0 };
  return { dx: -dx, dy: -dy };
}

// ───────── Teclado ─────────

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export type ZoomKey = "in" | "out" | "fit";

/**
 * Tecla de zoom del mapa: «+», «−» o «0», con o sin Ctrl (⌘ en macOS). Mira el carácter y la
 * posición (teclado español: «+» está en BracketRight; el teclado numérico también vale).
 * `needMod`: exigir Ctrl/⌘ (cuando el foco no está en el mapa). Alt nunca.
 */
export function zoomKey(e: KeyLike, mac: boolean, needMod: boolean): ZoomKey | null {
  if (e.altKey) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (other || (needMod && !mod)) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || (mod && e.code === "Equal")) return "in";
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || (mod && e.code === "Minus")) return "out";
  if (e.key === "0" || e.code === "Numpad0" || (mod && e.code === "Digit0")) return "fit";
  return null;
}
