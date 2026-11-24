// Tipos y utilidades puras del controlador de terminal (mensajes ANSI y lectura de línea).
import type { Terminal } from "@xterm/xterm";

export type TermStatus = "opening" | "running" | "exited";
/** Estado de la conexión SSH de la pestaña (de `useTabs`). */
export type ConnState = "connected" | "reconnecting" | "closed";

/** Resultado de abrir la shell respecto a tmux. */
export interface TmuxState {
  /** La shell corre dentro de tmux (sobrevive a cortes de red). */
  persistent: boolean;
  /** Se pidió tmux pero el servidor no lo tiene. */
  missing: boolean;
  problem: string | null;
}

/** Resultado de abrir la shell. */
export interface TermOpenResult {
  termId: string;
  /** Sesión tmux en la que quedó (solo SSH). */
  tmux?: string | null;
  /** True si al reconectar se volvió a la sesión tmux que ya existía (false si se creó una nueva). */
  tmuxReattached?: boolean;
  tmuxMissing?: boolean;
  tmuxProblem?: string | null;
}

/** De dónde sale la shell cuando no es la de un servidor (p. ej. la terminal local). */
export interface TermBackend {
  open: (cols: number, rows: number, onData: (bytes: Uint8Array) => void) => Promise<TermOpenResult>;
  write: (termId: string, data: string) => Promise<void>;
  resize: (termId: string, cols: number, rows: number) => Promise<void>;
  close: (termId: string) => Promise<void>;
}

export interface TermControllerOptions {
  sessionId: string;
  /** Otra fuente de shell (terminal local). Sin esto: shell SSH de `sessionId`. */
  backend?: TermBackend | null;
  /** Sesión tmux de esta terminal (null = shell normal). */
  tmuxName: string | null;
  /** Volcar el historial de la sesión tmux al abrirla por primera vez (se reabre una que ya existía). */
  tmuxReplay: boolean;
  /** Tras cada apertura: si quedó dentro de tmux o no. */
  onTmux?: (s: TmuxState) => void;
  fontSize: number;
  fontFamily: string;
  disabled: boolean;
  connState: ConnState;
  onStatus: (s: TermStatus) => void;
  /** Ctrl+Mayús+F: la vista abre la barra de búsqueda. */
  onSearchRequest: () => void;
}

export interface SearchResults {
  index: number;
  count: number;
}

export const DIM = (s: string) => `\x1b[0m\x1b[2m${s}\x1b[0m`;
export const RED = (s: string) => `\x1b[0m\x1b[31m${s}\x1b[0m`;

export function formatReconnectMessage(persistent: boolean, wasPersistent: boolean, reattached?: boolean): string {
  if (persistent && reattached) return "— reconectado: volviendo a la sesión tmux —";
  if (persistent && wasPersistent) return "— reconectado: la sesión tmux anterior terminó, abriendo una nueva —";
  return "— reconectado —";
}

export function formatExitMessage(disabled: boolean, connState: ConnState, code: number | null): string {
  if (disabled || connState === "closed") return "[Conexión cerrada]";
  if (connState === "reconnecting") return "[Conexión perdida]";
  if (code !== null && code !== 0) return `[Proceso terminado (código ${code}) — pulsa Enter para abrir otra shell]`;
  return "[Proceso terminado — pulsa Enter para abrir otra shell]";
}

/** Texto de la línea donde está el cursor (con las anteriores si es continuación de ellas). */
export function readCursorLine(term: Terminal): string {
  const buf = term.buffer.active;
  let y = buf.baseY + buf.cursorY;
  let text = buf.getLine(y)?.translateToString(true) ?? "";
  while (y > 0 && buf.getLine(y)?.isWrapped) {
    y--;
    text = (buf.getLine(y)?.translateToString(false) ?? "") + text;
  }
  return text;
}
