// Tipos del controlador de terminal (estado, apertura de la shell, opciones y búsqueda).

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
