// Mapa de infraestructura: cuándo volver a leer lo guardado y cómo decir su antigüedad (lógica pura).
import { formatDuration } from "../../lib/format";

/** Pasado este tiempo, al volver al mapa se relee en segundo plano. */
export const MAX_AGE_MS = 10 * 60_000;
/** Mapas guardados como máximo (los más antiguos se olvidan). */
export const MAX_ENTRIES = 24;

export interface Stamp {
  /** Momento de la lectura (ms). */
  at: number;
  /** Conexión con la que se leyó (cambia al reconectar). */
  token: string;
}

/** ¿Hay que leer otra vez? Nunca leído, leído con otra conexión o demasiado antiguo. */
export function needsReload(entry: Stamp | undefined, token: string, now: number): boolean {
  return !entry || entry.token !== token || now - entry.at > MAX_AGE_MS;
}

/** «hace un momento», «hace 3 min», «hace 1 h 5 min». */
export function updatedAgo(at: number, now: number): string {
  const secs = Math.max(0, (now - at) / 1000);
  return secs < 60 ? "hace un momento" : `hace ${formatDuration(secs)}`;
}

/** Claves que sobran para quedarse con las `max` más recientes (sin contar `keep`, que se queda). */
export function staleKeys(entries: Record<string, Stamp>, keep: string, max = MAX_ENTRIES): string[] {
  return Object.entries(entries)
    .filter(([k]) => k !== keep)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(Math.max(0, max - 1))
    .map(([k]) => k);
}
