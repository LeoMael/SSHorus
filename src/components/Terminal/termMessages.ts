// Avisos que la propia terminal escribe (no vienen del programa): colores ANSI y textos de
// «reconectado» y «proceso terminado».
import type { ConnState } from "../../features/terminal";

/** Texto gris (informativo). */
export const DIM = (s: string) => `\x1b[0m\x1b[2m${s}\x1b[0m`;
/** Texto rojo (error). */
export const RED = (s: string) => `\x1b[0m\x1b[31m${s}\x1b[0m`;

/** Aviso al volver la conexión: si se recuperó la sesión tmux, si se abrió otra o si es una shell nueva. */
export function formatReconnectMessage(persistent: boolean, wasPersistent: boolean, reattached?: boolean): string {
  if (persistent && reattached) return "— reconectado: volviendo a la sesión tmux —";
  if (persistent && wasPersistent) return "— reconectado: la sesión tmux anterior terminó, abriendo una nueva —";
  return "— reconectado —";
}

/** Aviso al terminar la shell: conexión cerrada, perdida o el programa salió (con su código si no es 0). */
export function formatExitMessage(disabled: boolean, connState: ConnState, code: number | null): string {
  if (disabled || connState === "closed") return "[Conexión cerrada]";
  if (connState === "reconnecting") return "[Conexión perdida]";
  if (code !== null && code !== 0) return `[Proceso terminado (código ${code}) — pulsa Enter para abrir otra shell]`;
  return "[Proceso terminado — pulsa Enter para abrir otra shell]";
}
