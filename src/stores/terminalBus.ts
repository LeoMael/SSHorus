// Puente para escribir en la terminal activa de una sesión desde otros componentes
// (p. ej. la Biblioteca de comandos). BASE compartida.
//   TerminalArea registra su terminal activa con registerTerminalWriter(sessionId, fn).
//   La vista de la sesión registra con registerTerminalRevealer cómo dejar visible su terminal.
//   Otros llaman a sendToTerminal(sessionId, texto, ejecutar).

type Writer = (text: string) => void;
type Revealer = () => void;

const writers = new Map<string, Writer>();
const revealers = new Map<string, Revealer>();

/** Registra (o reemplaza) el escritor de la terminal activa de la sesión. Devuelve función para quitarlo. */
export function registerTerminalWriter(sessionId: string, writer: Writer): () => void {
  writers.set(sessionId, writer);
  return () => {
    if (writers.get(sessionId) === writer) writers.delete(sessionId);
  };
}

/** Registra cómo mostrar la terminal de la sesión (su pestaña y el panel, si está plegado). */
export function registerTerminalRevealer(sessionId: string, reveal: Revealer): () => void {
  revealers.set(sessionId, reveal);
  return () => {
    if (revealers.get(sessionId) === reveal) revealers.delete(sessionId);
  };
}

export function hasTerminal(sessionId: string): boolean {
  return writers.has(sessionId);
}

/**
 * Escribe `text` en la terminal activa de la sesión. Si `execute`, añade Enter ("\r").
 * La deja a la vista y con el foco, para ver el resultado al momento.
 * Devuelve false si la sesión no tiene terminal abierta.
 */
export function sendToTerminal(sessionId: string, text: string, execute: boolean): boolean {
  const w = writers.get(sessionId);
  if (!w) return false;
  revealers.get(sessionId)?.();
  w(execute ? `${text}\r` : text);
  return true;
}
