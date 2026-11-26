// Historia que guarda el muestreo entre muestras (funciones puras): los puntos de las gráficas y los
// contadores de CPU para la alerta de «CPU alta sostenida».
import type { CpuTicks } from "./sample";
import { sustainedCpu, type HistoryPoint } from "./derive";
import { HISTORY_MS } from "./prefs";

/** Contadores de CPU que se guardan como mucho (s, por el reloj del servidor). */
const CPU_HISTORY_SECS = 600;

export interface CpuMark {
  uptime: number;
  cpu: CpuTicks;
}

/** Añade un punto y quita los que ya no caben en la ventana de las gráficas (5 min). */
export function appendHistory(history: HistoryPoint[], point: HistoryPoint, now: number): HistoryPoint[] {
  const cutoff = now - HISTORY_MS;
  const out = history.filter((p) => p.t >= cutoff);
  out.push(point);
  return out;
}

/**
 * CPU media sostenida hasta esta muestra y los contadores que hay que guardar para la próxima.
 * Usa el reloj del servidor (uptime): así no influye lo que tarde en llegar cada muestra. Si el
 * servidor se reinició (uptime menor), se descarta lo anterior.
 */
export function nextCpuHistory(hist: CpuMark[], now: CpuMark | null): { sustained: number | null; hist: CpuMark[] } {
  if (!now) return { sustained: null, hist };
  const sustained = sustainedCpu(hist, now);
  const kept = hist.filter((h) => now.uptime - h.uptime < CPU_HISTORY_SECS && h.uptime < now.uptime);
  kept.push(now);
  return { sustained, hist: kept };
}
