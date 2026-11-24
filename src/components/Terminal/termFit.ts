// Tamaño de una terminal: ajusta columnas y filas al contenedor cuando este cambia de tamaño.
import type { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

/** Espera tras el último cambio de tamaño antes de ajustar columnas y filas (y avisar al programa):
 *  al arrastrar el borde de la ventana, el programa redibuja una vez y no en cada píxel. */
const FIT_DEBOUNCE_MS = 80;

export class TermFit {
  private readonly fit = new FitAddon();
  private readonly ro: ResizeObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  /** Llamar después de `term.open(host)`. */
  constructor(
    private readonly term: Terminal,
    private readonly host: HTMLElement,
  ) {
    term.loadAddon(this.fit);
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(host);
    // Cuando cargan las fuentes cambian las medidas de cada celda.
    document.fonts?.ready.then(() => this.fitNow()).catch(() => {});
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fitNow(), FIT_DEBOUNCE_MS);
  }

  /** Ajusta columnas/filas al contenedor, solo si está visible. */
  fitNow() {
    if (this.disposed) return;
    if (!this.host.offsetWidth || !this.host.offsetHeight) return;
    const dims = this.fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    if (dims.cols < 2 || dims.rows < 1) return;
    if (dims.cols !== this.term.cols || dims.rows !== this.term.rows) {
      this.term.resize(dims.cols, dims.rows);
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.ro.disconnect();
  }
}
