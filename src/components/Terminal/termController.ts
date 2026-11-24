// Controlador de una terminal: une una instancia de xterm.js con una shell remota (SSH) o, con un
// `backend` propio, con una shell de este equipo (terminal local).
// Independiente de React: el componente solo lo crea, le pasa cambios y lo destruye.
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchResultChangeEvent } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import { terminal } from "../../api/terminal";
import { errorMessage } from "../../api/core";
import { toast } from "../../stores/toasts";
import { buildSearchDecorations, buildTermTheme, onAppThemeChange } from "./termTheme";
import { ensureExitListener, onTerminalExit } from "./exitEvents";
import { RENDER_OPTIONS, TermGpu, enableUnicode11 } from "./termRender";
import { terminalFontStack } from "./termFont";
import { copyTermSelection, createTermKeyHandler, pasteCheckedToTerm, pasteClipboardToTerm } from "./termClipboard";
import {
  DIM,
  RED,
  formatExitMessage,
  formatReconnectMessage,
  readCursorLine,
  type ConnState,
  type SearchResults,
  type TermBackend,
  type TermControllerOptions,
  type TermOpenResult,
  type TermStatus,
  type TmuxState,
} from "./termTypes";

export type { ConnState, SearchResults, TermBackend, TermControllerOptions, TermOpenResult, TermStatus, TmuxState };

/** Si la shell termina sin código (posible caída de la conexión), se espera esto antes de
 *  decidir qué mensaje mostrar: el vigilante del motor detecta la caída en ~1,5 s. */
const EXIT_GRACE_MS = 2500;

/** Espera tras el último cambio de tamaño antes de ajustar columnas y filas (y avisar al programa):
 *  al arrastrar el borde de la ventana, el programa redibuja una vez y no en cada píxel. */
const FIT_DEBOUNCE_MS = 80;

/** Tras escribir desde fuera, durante este tiempo se repinta entera al llegar salida (el eco). */
const REVEAL_REPAINT_MS = 1500;

export class TermController {
  readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly search = new SearchAddon({ highlightLimit: 2000 });
  private readonly host: HTMLElement;
  private readonly sessionId: string;
  private readonly backend: TermBackend | null;
  private readonly onStatus: (s: TermStatus) => void;
  private readonly tmuxName: string | null;
  private tmuxReplay: boolean;
  private readonly onTmux: ((s: TmuxState) => void) | undefined;
  /** La shell actual corre dentro de tmux. */
  private persistent = false;
  private disabled: boolean;
  private connState: ConnState;
  /** La shell murió con la conexión (o no pudo abrirse): se reabre al reconectar. */
  private lost = false;
  private exitTimer: ReturnType<typeof setTimeout> | undefined;
  /** Hay un aviso de salida esperando a saber si fue la conexión. */
  private exitMsgPending = false;

  private status: TermStatus = "opening";
  private termId: string | null = null;
  /** Generación de shell: invalida respuestas de aperturas viejas. */
  private gen = 0;
  private disposed = false;

  // Escritura ordenada: un solo `term_write` en vuelo, el resto se agrupa.
  private pending = "";
  private inFlight = false;

  /** Hasta cuándo repintar al llegar salida (ver `reveal`). */
  private repaintUntil = 0;
  private repaintQueued = false;

  private fitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly ro: ResizeObserver;
  private readonly unTheme: () => void;
  private unExit: (() => void) | null = null;
  private readonly gpu: TermGpu;

  constructor(host: HTMLElement, opts: TermControllerOptions) {
    this.host = host;
    this.sessionId = opts.sessionId;
    this.backend = opts.backend ?? null;
    this.onStatus = opts.onStatus;
    this.tmuxName = opts.tmuxName;
    this.tmuxReplay = opts.tmuxReplay;
    this.onTmux = opts.onTmux;
    this.disabled = opts.disabled;
    this.connState = opts.connState;

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
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    this.term.loadAddon(
      new WebLinksAddon((ev, uri) => {
        ev.preventDefault();
        openUrl(uri).catch((e) => toast.error("No se pudo abrir el enlace", e));
      }),
    );
    this.term.open(host);
    this.term.attachCustomKeyEventHandler(
      createTermKeyHandler(this.term, {
        onSearch: opts.onSearchRequest,
        onCopy: (clear) => this.copy(clear),
        onPaste: () => this.paste(),
      }),
    );
    this.term.onData((d) => this.handleInput(d));
    this.term.onResize(() => this.sendResize());
    // Todo pegado (también el del sistema: clic central en Linux) pasa por el aviso de varias líneas.
    this.term.element?.addEventListener("paste", this.handlePasteEvent, true);

    this.ro = new ResizeObserver(() => this.scheduleFit());
    this.ro.observe(host);
    this.unTheme = onAppThemeChange(() => {
      if (!this.disposed) this.term.options.theme = buildTermTheme();
    });
    this.gpu = new TermGpu(this.term);
    document.fonts?.ready.then(() => this.fitNow()).catch(() => {});

    this.fitNow();
    void this.start();
  }

  /** Escribir, redimensionar y cerrar: por SSH o por el `backend` propio. */
  private get api(): Pick<TermBackend, "write" | "resize" | "close"> {
    return this.backend ?? terminal;
  }

  // ───────── Ciclo de vida de la shell ─────────

  private setStatus(s: TermStatus) {
    this.status = s;
    if (!this.disposed) this.onStatus(s);
  }

  private canOpen(): boolean {
    return !this.disposed && !this.disabled && this.connState === "connected";
  }

  private async start(reconnected = false) {
    if (!this.canOpen()) return;
    const gen = ++this.gen;
    const wasPersistent = this.persistent;
    this.cancelExitMessage();
    this.setStatus("opening");
    try {
      await ensureExitListener();
    } catch {
      /* sin el evento seguimos: la shell funciona, solo no avisará al salir */
    }
    if (this.disposed || gen !== this.gen) return;
    this.fitNow();
    const { cols, rows } = this.term;
    const tmux = this.tmuxName ? { name: this.tmuxName, replay: this.tmuxReplay, checkExisting: reconnected } : null;
    // Al reconectar retenemos los primeros bytes hasta escribir el aviso arriba del nuevo prompt.
    let preBytes: Uint8Array[] | null = reconnected ? [] : null;
    const onData = (bytes: Uint8Array) => {
      if (this.disposed || gen !== this.gen) return;
      if (preBytes) preBytes.push(bytes);
      else this.writeOutput(bytes);
    };
    try {
      const opened: TermOpenResult = this.backend
        ? await this.backend.open(cols, rows, onData)
        : await terminal.open(this.sessionId, cols, rows, onData, tmux);
      const id = opened.termId;
      if (this.disposed || gen !== this.gen) {
        this.api.close(id).catch(() => {});
        return;
      }
      this.termId = id;
      this.lost = false;
      this.tmuxReplay = false;
      this.persistent = (opened.tmux ?? null) !== null;
      if (reconnected) {
        const msg = formatReconnectMessage(this.persistent, wasPersistent, opened.tmuxReattached);
        this.term.write(`\r\n${DIM(msg)}\r\n`);
        const buffered = preBytes ?? [];
        preBytes = null;
        for (const chunk of buffered) this.writeOutput(chunk);
      }
      if (!this.backend) {
        this.onTmux?.({
          persistent: this.persistent,
          missing: opened.tmuxMissing ?? false,
          problem: opened.tmuxProblem ?? null,
        });
      }
      this.setStatus("running");
      this.unExit = onTerminalExit(id, (code) => this.handleExit(id, code));
      if (this.term.cols !== cols || this.term.rows !== rows) this.sendResize();
      if (this.pending) void this.pump();
    } catch (e) {
      preBytes = null;
      if (this.disposed || gen !== this.gen) return;
      this.pending = "";
      this.lost = true;
      this.setStatus("exited");
      if (this.connState !== "connected") return;
      this.term.write(`\r\n${RED(`No se pudo abrir la shell: ${errorMessage(e)}`)}\r\n`);
      if (!this.disabled) this.term.write(`${DIM("[Pulsa Enter para reintentar]")}\r\n`);
    }
  }

  private handleExit(id: string, code: number | null) {
    if (this.disposed || id !== this.termId) return;
    this.termId = null;
    this.unExit = null;
    this.pending = "";
    this.lost = code === null || this.connState !== "connected";
    this.setStatus("exited");
    if (code === null && this.connState === "connected" && !this.disabled) {
      this.cancelExitMessage();
      this.exitMsgPending = true;
      this.exitTimer = setTimeout(() => {
        if (!this.exitMsgPending || this.disposed) return;
        this.exitMsgPending = false;
        if (this.status === "exited") this.writeExitMessage(code);
      }, EXIT_GRACE_MS);
      return;
    }
    this.writeExitMessage(code);
  }

  private cancelExitMessage() {
    clearTimeout(this.exitTimer);
    this.exitMsgPending = false;
  }

  private writeExitMessage(code: number | null) {
    this.term.write(`\r\n${DIM(formatExitMessage(this.disabled, this.connState, code))}\r\n`);
  }

  /** La sesión volvió (mismo sessionId, conexión nueva): reabre la shell si murió con la caída. */
  reconnected() {
    if (this.disposed || this.disabled) return;
    this.connState = "connected";
    if (this.status === "exited" && !this.lost) return;
    this.cancelExitMessage();
    this.unExit?.();
    this.unExit = null;
    if (this.termId) this.api.close(this.termId).catch(() => {});
    this.termId = null;
    this.pending = "";
    void this.start(true);
  }

  setConnState(state: ConnState) {
    if (this.connState === state) return;
    const prev = this.connState;
    this.connState = state;
    if (state !== "connected") {
      this.pending = "";
      if (prev === "connected" && this.exitMsgPending) {
        this.cancelExitMessage();
        this.writeExitMessage(null);
      }
    }
  }

  // ───────── Entrada / salida ─────────

  private handleInput(data: string) {
    if (this.connState !== "connected") return;
    if (this.status === "running" && this.termId) {
      this.pending += data;
      void this.pump();
    } else if (this.status === "opening") {
      this.pending += data;
    } else if (this.status === "exited" && !this.disabled && data.includes("\r")) {
      this.term.write("\r\n");
      void this.start();
    }
  }

  private async pump() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.pending && this.termId && !this.disposed) {
        const id = this.termId;
        const data = this.pending;
        this.pending = "";
        try {
          await this.api.write(id, data);
        } catch {
          /* la shell terminó: el evento de salida lo indicará */
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  sendText(text: string) {
    if (this.disposed || !text || this.disabled || this.connState !== "connected") return;
    if (this.status === "exited") {
      this.pending = text;
      this.term.write("\r\n");
      void this.start();
      return;
    }
    this.handleInput(text);
  }

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

  private writeOutput(bytes: Uint8Array) {
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

  cursorLineText(): string {
    return this.disposed ? "" : readCursorLine(this.term);
  }

  pasteText(text: string) {
    if (!this.disposed && text) this.term.paste(text);
  }

  acceptsBracketedPaste(): boolean {
    return !this.disposed && this.term.modes.bracketedPasteMode;
  }

  isRunning(): boolean {
    return this.status === "running" && this.termId !== null;
  }

  note(text: string) {
    if (!this.disposed) this.term.write(`${DIM(text.replace(/\r?\n/g, "\r\n"))}\r\n`);
  }

  copy(clearSelection = false) {
    copyTermSelection(this.term, clearSelection);
  }

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

  isPersistent(): boolean {
    return this.persistent;
  }

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  // ───────── Búsqueda y tamaño ─────────

  private searchOpts(caseSensitive: boolean, incremental = false) {
    return { caseSensitive, incremental, decorations: buildSearchDecorations() };
  }

  findNext(query: string, caseSensitive: boolean, incremental = false): boolean {
    return this.disposed || !query ? false : this.search.findNext(query, this.searchOpts(caseSensitive, incremental));
  }

  findPrevious(query: string, caseSensitive: boolean): boolean {
    return this.disposed || !query ? false : this.search.findPrevious(query, this.searchOpts(caseSensitive));
  }

  clearSearch() {
    if (this.disposed) return;
    this.search.clearDecorations();
    this.term.clearSelection();
  }

  onSearchResults(cb: (r: SearchResults) => void): () => void {
    const d = this.search.onDidChangeResults((e: ISearchResultChangeEvent) =>
      cb({ index: e.resultIndex, count: e.resultCount }),
    );
    return () => d.dispose();
  }

  private scheduleFit() {
    clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => this.fitNow(), FIT_DEBOUNCE_MS);
  }

  fitNow() {
    if (this.disposed || !this.host.offsetWidth || !this.host.offsetHeight) return;
    const dims = this.fit.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 2 || dims.rows < 1) return;
    if (dims.cols !== this.term.cols || dims.rows !== this.term.rows) this.term.resize(dims.cols, dims.rows);
  }

  private sendResize() {
    if (this.termId && !this.disposed) this.api.resize(this.termId, this.term.cols, this.term.rows).catch(() => {});
  }

  show(focus: boolean) {
    requestAnimationFrame(() => {
      if (this.disposed) return;
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

  setDisabled(disabled: boolean) {
    this.disabled = disabled;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    clearTimeout(this.fitTimer);
    this.cancelExitMessage();
    this.ro.disconnect();
    this.unTheme();
    this.term.element?.removeEventListener("paste", this.handlePasteEvent, true);
    this.gpu.dispose();
    this.unExit?.();
    if (this.termId) this.api.close(this.termId).catch(() => {});
    this.termId = null;
    this.term.dispose();
  }
}
