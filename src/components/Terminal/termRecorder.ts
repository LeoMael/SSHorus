// Guarda en el historial del servidor los comandos escritos en una terminal SSH, solo si el usuario lo
// activó (features/serverHistory/prefs). Lee la línea de la pantalla, no las teclas: al empezar a escribir
// se marca dónde acaba el aviso de la shell y, al pulsar Enter, cuando la shell pasa de línea, se lee lo que
// hay detrás. Nunca tras un aviso de contraseña (`commandFromLine`) ni en programas a pantalla completa
// (vim, less, top…). Lo que se escribe por fuera del teclado (Biblioteca, «Escribir la contraseña de
// sudo») no pasa por aquí.
import type { IBuffer, IDisposable, IMarker, Terminal } from "@xterm/xterm";
import { abandonsLine, commandFromLine, recordEvent, serverOfSession, terminalLogOn } from "../../features/serverHistory";

export interface RecordTarget {
  serverId: string;
  serverName: string;
}

/** El servidor de la conexión, si ahora se registra lo que se escribe en su terminal. */
export function sessionTarget(sessionId: string): RecordTarget | null {
  const srv = serverOfSession(sessionId);
  return srv && terminalLogOn(srv.id) ? { serverId: srv.id, serverName: srv.name } : null;
}

/** Si la shell no pasa de línea en este tiempo, se lee igual. */
const ECHO_WAIT_MS = 3000;

interface Anchor {
  marker: IMarker;
  /** Texto de la línea antes del cursor al empezar a escribir (el aviso de la shell). */
  prompt: string;
}

/** Texto de la fila `y` y de las que la continúan (línea partida por el ancho). */
function logicalLine(buf: IBuffer, y: number): string {
  let out = "";
  for (let i = y; ; i++) {
    const line = buf.getLine(i);
    if (!line) break;
    const cont = buf.getLine(i + 1)?.isWrapped ?? false;
    out += line.translateToString(!cont);
    if (!cont) break;
  }
  return out;
}

export class TermRecorder {
  private anchor: Anchor | null = null;
  /** Línea ya terminada (Enter) esperando a que la shell pase de línea. */
  private pending: { anchor: Anchor; target: RecordTarget; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly subs: IDisposable[];

  /** `target()`: dónde guardar, o null si ahora no se registra esta terminal. */
  constructor(
    private readonly term: Terminal,
    private readonly target: () => RecordTarget | null,
  ) {
    this.subs = [term.onData((d) => this.onData(d)), term.onLineFeed(() => this.flush())];
  }

  private onData(data: string) {
    const target = this.target();
    if (!target || this.term.buffer.active.type !== "normal" || abandonsLine(data)) {
      this.dropAnchor();
      return;
    }
    if (!this.anchor) this.anchor = this.mark();
    if (!data.includes("\r") || !this.anchor) return;
    // Varias líneas a la vez (un pegado): solo la primera, la única cuyo aviso se conoce.
    this.flush();
    const anchor = this.anchor;
    this.anchor = null;
    this.pending = { anchor, target, timer: setTimeout(() => this.flush(), ECHO_WAIT_MS) };
  }

  private mark(): Anchor | null {
    const buf = this.term.buffer.normal;
    const marker = this.term.registerMarker(0);
    const row = buf.getLine(buf.baseY + buf.cursorY);
    if (!marker || !row) {
      marker?.dispose();
      return null;
    }
    return { marker, prompt: row.translateToString(false, 0, buf.cursorX) };
  }

  /** La shell ya mostró la línea entera: se lee y se guarda. */
  private flush() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    const { marker, prompt } = p.anchor;
    const line = marker.isDisposed ? null : logicalLine(this.term.buffer.normal, marker.line);
    marker.dispose();
    const cmd = line === null ? null : commandFromLine(line, prompt);
    if (cmd) recordEvent(p.target.serverId, { source: "terminal", title: cmd, detail: "", ok: null, result: "", serverName: p.target.serverName });
  }

  private dropAnchor() {
    this.anchor?.marker.dispose();
    this.anchor = null;
  }

  dispose() {
    for (const s of this.subs) s.dispose();
    this.dropAnchor();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.anchor.marker.dispose();
      this.pending = null;
    }
  }
}
