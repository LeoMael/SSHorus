// Una pestaña local por dentro: su shell y, encima, un asistente abierto «en esta terminal»
// (Asistente con contexto). El asistente es otro proceso con su propio PTY, porque el contexto y el
// token del MCP tienen que ir en su entorno y sus argumentos, nunca tecleados en la shell. Mientras
// corre, lo que se teclea va al asistente; al salir, se vuelve a la shell tal como estaba.
//
// Para la vista es un `TermBackend` más: el termId que ve es siempre el de la shell.
import type { AiLaunch, LocalOpened, LocalTermState } from "../../api/localterm";
import type { TermBackend, TermOpenResult } from "../../components/Terminal/termController";

/** Lo que usa del motor (en las pruebas, uno falso). */
export interface LocalApi {
  open: (
    opts: { cwd: string | null; cols: number; rows: number; launch: AiLaunch | null },
    onData: (bytes: Uint8Array) => void,
  ) => Promise<LocalOpened>;
  write: (termId: string, data: string) => Promise<void>;
  resize: (termId: string, cols: number, rows: number) => Promise<void>;
  close: (termId: string) => Promise<void>;
  state: (termId: string) => Promise<LocalTermState>;
  /** Aviso de salida del proceso. Devuelve la función para anularlo. */
  onExit: (termId: string, cb: (code: number | null) => void) => () => void;
}

/** Abre el proceso principal de la pestaña (la shell o el asistente de los botones rápidos). */
export type OpenBase = (cols: number, rows: number, onData: (bytes: Uint8Array) => void) => Promise<TermOpenResult>;

/** Al volver a la shell se deshacen los modos que el asistente pudo dejar puestos si salió de golpe:
 *  pantalla alternativa (1047, que no mueve el cursor si ya se estaba en la normal), cursor oculto,
 *  ratón, pegado entre corchetes y colores. */
export const RESTORE_MODES = "\x1b[?1047l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m";

interface Top {
  /** null mientras arranca. */
  id: string | null;
  /** Lo tecleado mientras arranca. */
  queued: string;
  unExit: () => void;
}

const encoder = new TextEncoder();

export class LocalSession implements TermBackend {
  private onData: ((bytes: Uint8Array) => void) | null = null;
  private baseId: string | null = null;
  private top: Top | null = null;
  private size = { cols: 80, rows: 24 };
  private readonly api: LocalApi;
  private readonly openBase: OpenBase;

  constructor(api: LocalApi, openBase: OpenBase) {
    this.api = api;
    this.openBase = openBase;
  }

  async open(cols: number, rows: number, onData: (bytes: Uint8Array) => void): Promise<TermOpenResult> {
    this.closeTop();
    this.onData = onData;
    this.size = { cols, rows };
    // Con un asistente encima, la salida de la shell no se mezcla con su pantalla.
    const r = await this.openBase(cols, rows, (b) => {
      if (!this.top) onData(b);
    });
    this.baseId = r.termId;
    return r;
  }

  write(termId: string, data: string): Promise<void> {
    const top = termId === this.baseId ? this.top : null;
    if (!top) return this.api.write(termId, data);
    if (top.id === null) {
      top.queued += data;
      return Promise.resolve();
    }
    return this.api.write(top.id, data);
  }

  async resize(termId: string, cols: number, rows: number): Promise<void> {
    if (termId === this.baseId) this.size = { cols, rows };
    // La shell también: al volver a ella ya tiene el tamaño de la ventana.
    const ids = [termId, termId === this.baseId ? this.top?.id : null].filter((x): x is string => !!x);
    await Promise.all(ids.map((id) => this.api.resize(id, cols, rows)));
  }

  close(termId: string): Promise<void> {
    if (termId === this.baseId) {
      this.closeTop();
      this.baseId = null;
    }
    return this.api.close(termId);
  }

  /** La shell está abierta (se puede abrir un asistente encima). */
  isOpen(): boolean {
    return this.baseId !== null;
  }

  /** Hay un asistente abierto encima de la shell. */
  hasTop(): boolean {
    return this.top !== null;
  }

  /** Carpeta actual de la shell y si está ocupada con otro programa. */
  async shellState(): Promise<LocalTermState> {
    if (!this.baseId) return { cwd: null, busy: null };
    return this.api.state(this.baseId);
  }

  /**
   * Abre `launch` encima de la shell, en `cwd`. Devuelve null si la pestaña se cerró mientras
   * arrancaba. `onEnd` se llama cuando el asistente termina y se vuelve a la shell.
   */
  async runOnTop(launch: AiLaunch, cwd: string | null, onEnd: (code: number | null) => void): Promise<LocalOpened | null> {
    const out = this.onData;
    if (!this.baseId || !out) throw new Error("La terminal no está abierta");
    if (this.top) throw new Error("Ya hay un asistente abierto en esta terminal");
    const top: Top = { id: null, queued: "", unExit: () => {} };
    this.top = top;
    let r: LocalOpened;
    try {
      r = await this.api.open({ cwd, cols: this.size.cols, rows: this.size.rows, launch }, (b) => {
        if (this.top === top) out(b);
      });
    } catch (e) {
      if (this.top === top) this.top = null;
      throw e;
    }
    if (this.top !== top) {
      // Se cerró la pestaña (o se reabrió la shell) mientras arrancaba.
      this.api.close(r.termId).catch(() => {});
      return null;
    }
    top.id = r.termId;
    top.unExit = this.api.onExit(r.termId, (code) => {
      if (this.top !== top) return;
      this.top = null;
      out(encoder.encode(RESTORE_MODES));
      onEnd(code);
      const base = this.baseId;
      if (!base) return;
      // Un Enter vacío: la shell vuelve a dibujar su prompt.
      this.api.resize(base, this.size.cols, this.size.rows).catch(() => {});
      this.api.write(base, "\r").catch(() => {});
    });
    if (top.queued) {
      const q = top.queued;
      top.queued = "";
      this.api.write(r.termId, q).catch(() => {});
    }
    return r;
  }

  /** Al desmontar la pestaña: el asistente de encima también termina. */
  dispose(): void {
    this.closeTop();
  }

  private closeTop() {
    const t = this.top;
    if (!t) return;
    this.top = null;
    t.unExit();
    if (t.id) this.api.close(t.id).catch(() => {});
  }
}
