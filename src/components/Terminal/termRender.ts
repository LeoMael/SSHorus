// Dibujado de una terminal xterm.js: anchos de carácter Unicode y aceleración por GPU (WebGL).
//
// Anchos: xterm.js mide por defecto con las tablas de Unicode 6, donde los emojis (✅ ❌ ⚡ 🔍 🤖…)
// ocupan una celda. Los programas modernos (Claude Code, Codex, OpenCode, las shells con wcwidth
// actual) los cuentan como dos. Con esa diferencia el programa y la terminal no están de acuerdo en
// dónde acaba cada línea: las letras se juntan o se pasan al renglón siguiente al redibujar.
// Con Unicode 11 los dos cuentan igual.
import type { ITerminalOptions, Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { getTerminalGpu, isWebglUnsupported, markWebglUnsupported, onTerminalGpuChange } from "./gpuPref";

/** Si el contexto WebGL se pierde más veces que esto, la terminal se queda con el dibujado normal. */
const MAX_WEBGL_LOSSES = 2;

/** Opciones de dibujado comunes a todas las terminales. */
export const RENDER_OPTIONS: ITerminalOptions = {
  lineHeight: 1.1,
  letterSpacing: 0,
  // Símbolos que la fuente no tiene (⏺ ✻ ⎿…) salen de otra más ancha: se estrechan a su celda
  // en vez de montarse sobre la letra siguiente.
  rescaleOverlappingGlyphs: true,
  // Los marcos y bloques se dibujan a medida (sin huecos entre líneas aunque la fuente no los tenga).
  customGlyphs: true,
  // La API «propuesta» la necesitan Unicode 11 y las decoraciones de la búsqueda.
  allowProposedApi: true,
};

/** Activa los anchos de Unicode 11 (ver arriba). Llamar antes de escribir nada. */
export function enableUnicode11(term: Terminal): void {
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
}

/** Dibujado por GPU de una terminal: se activa si está permitido y disponible; si falla o se
 *  pierde el contexto, sigue con el dibujado normal (DOM). */
export class TermGpu {
  private addon: WebglAddon | null = null;
  private losses = 0;
  private disposed = false;
  private readonly unPref: () => void;

  constructor(private readonly term: Terminal) {
    this.unPref = onTerminalGpuChange((on) => {
      if (on) {
        this.losses = 0;
        this.enable();
      } else this.disable();
    });
    this.enable();
  }

  enable(): void {
    if (this.disposed || this.addon) return;
    if (!getTerminalGpu() || isWebglUnsupported() || this.losses > MAX_WEBGL_LOSSES) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        // La tarjeta gráfica se reinició o hay demasiados contextos abiertos: volver al dibujado normal.
        this.losses++;
        this.disable();
      });
      this.term.loadAddon(addon);
      this.addon = addon;
    } catch (e) {
      console.warn("Terminal: sin aceleración por GPU, se usa el dibujado normal", e);
      markWebglUnsupported();
    }
  }

  disable(): void {
    const a = this.addon;
    if (!a) return;
    this.addon = null;
    try {
      a.dispose();
    } catch {
      /* ya estaba liberado */
    }
    if (!this.disposed) this.term.refresh(0, this.term.rows - 1);
  }

  dispose(): void {
    this.disposed = true;
    this.unPref();
    this.disable();
  }
}
