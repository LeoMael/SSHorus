// Controlador de una terminal: une una instancia de xterm.js con una shell remota (SSH) o, con un
// `backend` propio, con una shell de este equipo (terminal local).
// Independiente de React: el componente solo lo crea, le pasa cambios y lo destruye.
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { terminal } from "../../api/terminal";
import { errorMessage } from "../../api/core";
import { toast } from "../../stores/toasts";
import { buildTermTheme, onAppThemeChange } from "./termTheme";
import { ensureExitListener, onTerminalExit } from "./exitEvents";
import { RENDER_OPTIONS, TermGpu, enableUnicode11 } from "./termRender";
import { terminalFontStack } from "./termFont";
import { copyTermSelection, createTermKeyHandler, pasteCheckedToTerm, pasteClipboardToTerm } from "./termClipboard";
import { TermFit } from "./termFit";
import { TermSearch } from "./termSearch";
import { DIM, RED, formatExitMessage, formatReconnectMessage } from "./termMessages";
import { readCursorLine } from "./termText";
import type {
  ConnState,
  SearchResults,
  TermBackend,
  TermControllerOptions,
  TermOpenResult,
  TermStatus,
  TmuxState,
} from "./termTypes";

export type { ConnState, SearchResults, TermBackend, TermControllerOptions, TermOpenResult, TermStatus, TmuxState };

/** Si la shell termina sin código (posible caída de la conexión), se espera esto antes de
 *  decidir qué mensaje mostrar: el vigilante del motor detecta la caída en ~1,5 s. */
const EXIT_GRACE_MS = 2500;

/** Tras escribir desde fuera, durante este tiempo se repinta entera al llegar salida (el eco). */
const REVEAL_REPAINT_MS = 1500;

export class TermController {
  readonly term: Terminal;
  private readonly fit: TermFit;
  private readonly search: TermSearch;
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

  private readonly unTheme: () => void;
  private unExit: (() => void) | null = null;
  private readonly gpu: TermGpu;

  constructor(host: HTMLElement, opts: TermControllerOptions) {
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
    this.search = new TermSearch(this.term);
    this.term.loadAddon(
      new WebLinksAddon((ev, uri) => {
        ev.preventDefault();
        openUrl(uri).catch((e) => toast.error("No se pudo abrir el enlace", e));
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
    this.term.onData((d) => this.handleInput(d));
    this.term.onResize(() => this.sendResize());
    // Todo pegado (también el del sistema: clic central en Linux) pasa por el aviso de varias líneas.
    this.term.element?.addEventListener("paste", this.handlePasteEvent, true);

    this.unTheme = onAppThemeChange(() => {
      if (!this.disposed) this.term.options.theme = buildTermTheme();
    });
    this.gpu = new TermGpu(this.term);

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
      // El historial ya está en xterm.js: al reabrir (reconexión) no se vuelve a volcar.
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
      // Si la conexión se está cayendo, el aviso de la pestaña ya lo explica.
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
    // Sin código de salida = el canal se cortó (normalmente, la conexión cayó).
    this.lost = code === null || this.connState !== "connected";
    this.setStatus("exited");
    if (code === null && this.connState === "connected" && !this.disabled) {
      // Esperar a saber si fue la conexión (llegará "reconectando"/"cerrada") antes de avisar.
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

  /** La sesión volvió (mismo sessionId, conexión nueva): reabre la shell si murió con la caída.
   *  Conserva el historial; las shells que el usuario cerró a propósito no se tocan. */
  reconnected() {
    if (this.disposed || this.disabled) return;
    this.connState = "connected";
    if (this.status === "exited" && !this.lost) return;
    // Cualquier shell "viva" pertenecía a la conexión anterior: ya no sirve.
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
      // Nada se acumula mientras no hay conexión.
      this.pending = "";
      if (prev === "connected" && this.exitMsgPending) {
        this.cancelExitMessage();
        this.writeExitMessage(null);
      }
    }
  }

  // ───────── Entrada del usuario ─────────

  private handleInput(data: string) {
    if (this.connState !== "connected") return; // sin conexión no se acumula nada
    if (this.status === "running" && this.termId) {
      this.pending += data;
      void this.pump();
    } else if (this.status === "opening") {
      // Lo tecleado mientras abre se envía al estar lista.
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

  /** Texto desde fuera (Biblioteca de comandos): mismo camino ordenado que el teclado.
   *  Si la shell había terminado, abre otra y lo envía al estar lista. */
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

  /** Texto de la línea donde está el cursor (con las anteriores si es continuación de ellas). */
  cursorLineText(): string {
    return this.disposed ? "" : readCursorLine(this.term);
  }

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

  /** La shell está abierta y lista para recibir texto. */
  isRunning(): boolean {
    return this.status === "running" && this.termId !== null;
  }

  /** Línea informativa (gris) en la terminal; no llega al programa. */
  note(text: string) {
    if (this.disposed) return;
    this.term.write(`${DIM(text.replace(/\r?\n/g, "\r\n"))}\r\n`);
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

  /** La shell actual corre dentro de tmux. */
  isPersistent(): boolean {
    return this.persistent;
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

  // ───────── Tamaño ─────────

  /** Ajusta columnas/filas al contenedor, solo si está visible. */
  fitNow() {
    if (!this.disposed) this.fit.fitNow();
  }

  private sendResize() {
    if (!this.termId || this.disposed) return;
    this.api.resize(this.termId, this.term.cols, this.term.rows).catch(() => {});
  }

  // ───────── Cambios desde React ─────────

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

  setDisabled(disabled: boolean) {
    this.disabled = disabled;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    this.fit.dispose();
    this.cancelExitMessage();
    this.unTheme();
    this.term.element?.removeEventListener("paste", this.handlePasteEvent, true);
    this.gpu.dispose();
    this.unExit?.();
    if (this.termId) this.api.close(this.termId).catch(() => {});
    this.termId = null;
    this.term.dispose();
  }
}
