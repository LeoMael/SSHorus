// Pruebas de la vista del mapa: zoom hacia un punto, límites, ajustar a la pantalla, rueda y teclado.
// Ejecutar: npx rolldown src/features/infra/viewport.test.ts -p node -f esm -o /tmp/viewport.mjs && node /tmp/viewport.mjs
import {
  centerOn,
  clampZoom,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  pinchStep,
  wheelIntent,
  wheelPan,
  wheelZoomFactor,
  zoomAt,
  zoomKey,
  zoomPercent,
  zoomStep,
  type KeyLike,
  type Viewport,
  type WheelLike,
} from "./viewport";

let fails = 0;
let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  n++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    fails++;
    console.error(`FALLO: ${msg}\n  obtenido: ${sa}\n  esperado: ${sb}`);
  }
}
function near(a: number, b: number, msg: string) {
  n++;
  if (Math.abs(a - b) > 1e-6) {
    fails++;
    console.error(`FALLO: ${msg}\n  obtenido: ${a}\n  esperado: ${b}`);
  }
}
/** Punto de pantalla donde se ve el punto del mapa (mx, my). */
const screen = (v: Viewport, mx: number, my: number) => [v.x + mx * v.k, v.y + my * v.k];
/** Punto del mapa que se ve en la pantalla (sx, sy). */
const world = (v: Viewport, sx: number, sy: number) => [(sx - v.x) / v.k, (sy - v.y) / v.k];

// ───────── Límites ─────────
eq(clampZoom(10), MAX_ZOOM, "tope de 400 %");
eq(clampZoom(0.01), MIN_ZOOM, "mínimo de 20 %");
eq(clampZoom(NaN), 1, "valor raro → 100 %");
eq(clampZoom(1.5), 1.5, "dentro de los límites");

// ───────── Zoom hacia el puntero ─────────
const v0: Viewport = { x: 40, y: -20, k: 1 };
const before = world(v0, 300, 200);
const v1 = zoomAt(v0, 2, 300, 200);
near(v1.k, 2, "zoom ×2");
const after = world(v1, 300, 200);
near(after[0], before[0], "el punto bajo el puntero no se mueve (x)");
near(after[1], before[1], "el punto bajo el puntero no se mueve (y)");
const v2 = zoomAt({ x: 0, y: 0, k: 3.5 }, 2, 100, 100);
eq(v2.k, MAX_ZOOM, "no pasa del máximo");
const [sx, sy] = screen(v2, ...(world({ x: 0, y: 0, k: 3.5 }, 100, 100) as [number, number]));
near(sx, 100, "en el tope también se mantiene el punto (x)");
near(sy, 100, "en el tope también se mantiene el punto (y)");
const vMax: Viewport = { x: 5, y: 6, k: MAX_ZOOM };
eq(zoomAt(vMax, 1.2, 0, 0) === vMax, true, "en el máximo, acercar no cambia nada");
eq(zoomAt({ x: 0, y: 0, k: MIN_ZOOM }, 0.5, 0, 0).k, MIN_ZOOM, "no baja del mínimo");
const st = zoomStep({ x: 0, y: 0, k: 1 }, 1, { w: 800, h: 600 });
near(st.k, 1.2, "botón «+» = ×1,2");
near(world(st, 400, 300)[0], 400, "el botón amplía hacia el centro");
near(zoomStep(st, -1, { w: 800, h: 600 }).k, 1, "«−» deshace «+»");

// ───────── Desplazar y centrar ─────────
eq(pan({ x: 1, y: 2, k: 1 }, 10, -5), { x: 11, y: -3, k: 1 }, "desplazar");
const c = centerOn({ x: 0, y: 0, k: 2 }, 100, 50, { w: 800, h: 600 });
eq(screen(c, 100, 50), [400, 300], "centrar un punto del mapa");

// ───────── Ajustar a la pantalla ─────────
const f1 = fitView({ width: 2000, height: 1000 }, { w: 1016, h: 800 });
near(f1.k, 0.492, "mapa ancho: manda el ancho (con margen)");
near(f1.x, (1016 - 2000 * 0.492) / 2, "centrado en horizontal");
near(f1.y, (800 - 1000 * 0.492) / 2, "centrado en vertical");
eq(fitView({ width: 200, height: 100 }, { w: 1000, h: 800 }).k, 1.25, "un mapa pequeño no pasa del 125 %");
eq(fitView({ width: 100000, height: 100 }, { w: 800, h: 600 }).k, MIN_ZOOM, "uno enorme se queda en el mínimo");
eq(fitView({ width: 100000, height: 100 }, { w: 800, h: 600 }).y >= 0, true, "nunca arriba de la pantalla");
eq(Number.isFinite(fitView({ width: 0, height: 0 }, { w: 0, h: 0 }).k), true, "sin tamaño no da NaN");
eq(zoomPercent(1.234), 123, "porcentaje");

// ───────── Rueda ─────────
const w = (o: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });
eq(wheelIntent(w({ deltaY: 100 })), "zoom", "rueda vertical → zoom");
eq(wheelIntent(w({ deltaY: 3, ctrlKey: true })), "zoom", "pellizco (Ctrl) → zoom");
eq(wheelIntent(w({ deltaX: 40, deltaY: 40, ctrlKey: true })), "zoom", "Ctrl siempre zoom");
eq(wheelIntent(w({ deltaX: 60, deltaY: 10 })), "pan", "touchpad horizontal → desplazar");
eq(wheelIntent(w({ deltaY: 100, shiftKey: true })), "pan", "Mayús → desplazar");
eq(wheelZoomFactor(w({ deltaY: -100 }), 600) > 1, true, "rueda hacia arriba acerca");
eq(wheelZoomFactor(w({ deltaY: 100 }), 600) < 1, true, "rueda hacia abajo aleja");
near(wheelZoomFactor(w({ deltaY: 100 }), 600) * wheelZoomFactor(w({ deltaY: -100 }), 600), 1, "una muesca arriba y otra abajo se anulan");
eq(wheelZoomFactor(w({ deltaY: -3, ctrlKey: true }), 600) > wheelZoomFactor(w({ deltaY: -3 }), 600), true, "el pellizco se amplifica");
eq(wheelZoomFactor(w({ deltaY: -3, deltaMode: 1 }), 600), wheelZoomFactor(w({ deltaY: -48 }), 600), "rueda en líneas = 16 px por línea");
eq(wheelZoomFactor(w({ deltaY: -100000 }), 600), 1.5, "cada evento queda acotado");
eq(wheelPan(w({ deltaX: 10, deltaY: 20 }), 600), { dx: -10, dy: -20 }, "desplazar con el touchpad");
eq(wheelPan(w({ deltaY: 30, shiftKey: true }), 600), { dx: -30, dy: 0 }, "Mayús + rueda → horizontal");

// ───────── Pellizco nativo (escala acumulada) ─────────
near(pinchStep(1, 1.1), 1.1, "primer paso del pellizco");
near(pinchStep(1.1, 1.21), 1.1, "cada paso es relativo al anterior");
near(pinchStep(1, 1.1) * pinchStep(1.1, 1), 1, "abrir y cerrar se anulan");
eq(pinchStep(1, 10), 1.5, "un salto grande queda acotado");
eq(pinchStep(0, 1.2), 1, "escala anterior rara → sin cambio");
eq(pinchStep(1, NaN), 1, "escala rara → sin cambio");

// ───────── Teclado ─────────
const k = (key: string, code: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, ...o });
eq(zoomKey(k("+", "BracketRight", { ctrlKey: true }), false, true), "in", "Ctrl + «+» (teclado español)");
eq(zoomKey(k("=", "Equal", { ctrlKey: true }), false, true), "in", "Ctrl + «=» (teclado inglés)");
eq(zoomKey(k("-", "Slash", { ctrlKey: true }), false, true), "out", "Ctrl + «−» (teclado español)");
eq(zoomKey(k("-", "NumpadSubtract", { ctrlKey: true }), false, true), "out", "Ctrl + «−» del teclado numérico");
eq(zoomKey(k("0", "Digit0", { ctrlKey: true }), false, true), "fit", "Ctrl + 0 = ajustar");
eq(zoomKey(k("+", "BracketRight"), false, true), null, "sin Ctrl y sin foco en el mapa: nada");
eq(zoomKey(k("+", "BracketRight"), false, false), "in", "con el foco en el mapa basta «+»");
eq(zoomKey(k("+", "BracketRight", { ctrlKey: true, altKey: true }), false, true), null, "Ctrl+Alt (AltGr) no");
eq(zoomKey(k("+", "BracketRight", { metaKey: true }), true, true), "in", "⌘ + «+» en macOS");
eq(zoomKey(k("+", "BracketRight", { ctrlKey: true }), true, true), null, "Ctrl en macOS no es el atajo");
eq(zoomKey(k("a", "KeyA", { ctrlKey: true }), false, true), null, "otra tecla");

console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas`);
if (fails) throw new Error("pruebas fallidas");
