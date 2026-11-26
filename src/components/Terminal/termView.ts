// La parte «de pantalla» de una terminal: la instancia de xterm.js con sus complementos (tema, GPU,
// enlaces, búsqueda, ajuste al tamaño, copiar y pegar). No sabe de ninguna shell: eso lo añade
// TermController (termController.ts), que la extiende.
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openLink } from "../ui/openLink";
import { buildTermTheme, onAppThemeChange } from "./termTheme";
import { RENDER_OPTIONS, TermGpu, enableUnicode11 } from "./termRender";
import { terminalFontStack } from "./termFont";
import { copyTermSelection, createTermKeyHandler, pasteCheckedToTerm, pasteClipboardToTerm } from "./termClipboard";
import { TermFit } from "./termFit";
import { TermSearch } from "./termSearch";
import { DIM } from "./termMessages";
import { readCursorLine } from "./termText";
import type { SearchResults, TermControllerOptions } from "../../features/terminal";

/** Tras escribir desde fuera, durante este tiempo se repinta entera al llegar salida (el eco). */
const REVEAL_REPAINT_MS = 1500;

type ViewOptions = Pick<TermControllerOptions, "fontSize" | "fontFamily" | "onSearchRequest">;

export class TermView {
  readonly term: Terminal;
  private readonly fit: TermFit;
  private readonly search: TermSearch;
  private readonly unTheme: () => void;
  private readonly gpu: TermGpu;
  protected disposed = false;

  /** Hasta cuándo repintar al llegar salida (ver `reveal`). */
  private repaintUntil = 0;
  private repaintQueued = false;

  constructor(host: HTMLElement, opts: ViewOptions) {
    this.term = new Terminal({
      ...RENDER_OPTIONS,
      fontSize: opts.fontSize,
      fontFamily: terminalFontStack(opts.fontFamily),
      theme: buildTermTheme(),
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      drawBoldTextInBrightColors: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: false,
    });
    enableUnicode11(this.term);
    this.search = new TermSearch(this.term);
    this.term.loadAddon(
      new WebLinksAddon((ev, uri) => {
        ev.preventDefault();
        openLink(uri);
      }),
    );
    this.term.open(host);
    this.fit = new TermFit(this.term, host);
    this.term.attachCustomKeyEventHandler(
      createTermKeyHandler(this.term, {
        onSearch: opts.onSearchRequest,
        onCopy: (clear) => this.copy(clear),
        onPaste: () => this.paste(),
      }),
    );
    // Todo pegado (también el del sistema: clic central en Linux) pasa por el aviso de varias líneas.
    this.term.element?.addEventListener("paste", this.handlePasteEvent, true);

    this.unTheme = onAppThemeChange(() => {
      if (!this.disposed) this.term.options.theme = buildTermTheme();
    });
    this.gpu = new TermGpu(this.term);
  }

  // ───────── Salida ─────────

  /**
   * Tras escribir desde fuera (Biblioteca de comandos, escáner…): ajusta, repinta y le da el foco.
   * Sin foco, el dibujado por GPU no siempre muestra el eco que llega después (se veía al hacer clic):
   * con el foco xterm redibuja todo y mantiene viva la línea del cursor, y por si acaso se repinta
   * entera al llegar el eco.
   */
  reveal() {
    if (this.disposed) return;
    this.repaintUntil = performance.now() + REVEAL_REPAINT_MS;
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.fitNow();
      this.term.refresh(0, this.term.rows - 1);
      this.term.focus();
    });
  }

  protected writeOutput(bytes: Uint8Array) {
    if (performance.now() > this.repaintUntil) this.term.write(bytes);
    else this.term.write(bytes, () => this.queueRepaint());
  }

  private queueRepaint() {
    if (this.repaintQueued || this.disposed) return;
    this.repaintQueued = true;
    requestAnimationFrame(() => {
      this.repaintQueued = false;
      if (!this.disposed) this.term.refresh(0, this.term.rows - 1);
    });
  }

  /** Texto de la línea donde está el cursor (con las anteriores si es continuación de ellas). */
  cursorLineText(): string {
    return this.disposed ? "" : readCursorLine(this.term);
  }

  /** Línea informativa (gris) en la terminal; no llega al programa. */
  note(text: string) {
    if (this.disposed) return;
    this.term.write(`${DIM(text.replace(/\r?\n/g, "\r\n"))}\r\n`);
  }

  // ───────── Copiar y pegar ─────────

  /** Pega texto como si lo pegara el usuario (con «pegado entre corchetes» si el programa lo pidió:
   *  así un texto de varias líneas no se ejecuta línea a línea). */
  pasteText(text: string) {
    if (this.disposed || !text) return;
    this.term.paste(text);
  }

  /** El programa activó el «pegado entre corchetes» (lo hacen las shells modernas y los asistentes de IA). */
  acceptsBracketedPaste(): boolean {
    return !this.disposed && this.term.modes.bracketedPasteMode;
  }

  /** Copia la selección sin los espacios de relleno del final de cada línea. */
  copy(clearSelection = false) {
    copyTermSelection(this.term, clearSelection);
  }

  /** Pega el portapapeles, avisando antes si son varias líneas y el programa las ejecutaría. */
  paste() {
    pasteClipboardToTerm(this.term, () => this.disposed);
  }

  private handlePasteEvent = (ev: ClipboardEvent) => {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    void pasteCheckedToTerm(this.term, ev.clipboardData?.getData("text/plain") ?? "", () => this.disposed);
  };

  selectAll() {
    this.term.selectAll();
  }

  clear() {
    this.term.clear();
    this.term.focus();
  }

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  // ───────── Búsqueda ─────────

  /** Busca hacia abajo. `incremental`: mientras se escribe (no avanza si la actual sigue valiendo). */
  findNext(query: string, caseSensitive: boolean, incremental = false): boolean {
    if (this.disposed) return false;
    return this.search.findNext(query, caseSensitive, incremental);
  }

  findPrevious(query: string, caseSensitive: boolean): boolean {
    if (this.disposed) return false;
    return this.search.findPrevious(query, caseSensitive);
  }

  clearSearch() {
    if (!this.disposed) this.search.clear();
  }

  onSearchResults(cb: (r: SearchResults) => void): () => void {
    return this.search.onResults(cb);
  }

  // ───────── Tamaño, foco y letra ─────────

  /** Ajusta columnas/filas al contenedor, solo si está visible. */
  fitNow() {
    if (!this.disposed) this.fit.fitNow();
  }

  show(focus: boolean) {
    requestAnimationFrame(() => {
      if (this.disposed) return;
      // Si perdió el contexto GPU mientras estaba oculta, reintentar (con límite).
      this.gpu.enable();
      this.fitNow();
      if (focus) this.term.focus();
    });
  }

  focus() {
    this.term.focus();
  }

  setFont(size: number, family: string) {
    if (this.disposed) return;
    const stack = terminalFontStack(family);
    if (this.term.options.fontSize === size && this.term.options.fontFamily === stack) return;
    this.term.options.fontSize = size;
    this.term.options.fontFamily = stack;
    this.fitNow();
  }

  /** Libera xterm.js y sus complementos. La subclase cierra antes su shell. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fit.dispose();
    this.unTheme();
    this.term.element?.removeEventListener("paste", this.handlePasteEvent, true);
    this.gpu.dispose();
    this.term.dispose();
  }
}
