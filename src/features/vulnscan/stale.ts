// ¿El informe en pantalla es de antes de un reinicio? Al abrir la pestaña se enseña el último análisis
// guardado; si el servidor se reinició (otro boot_id) o cambió el kernel en uso desde entonces, lo de
// «falta reiniciar» y lo ya arreglado puede seguir ahí hasta «Volver a comprobar». Script de solo
// lectura (sin sudo) y su lectura: funciones puras.
import type { Report } from "../../api/vulnscan";
import { splitSections } from "../../lib/remote";

export const BOOT_CHECK_SCRIPT = "echo @@bootid; cat /proc/sys/kernel/random/boot_id 2>/dev/null; echo @@kernel; uname -r 2>/dev/null; echo @@end";

export interface BootNow {
  bootId: string | null;
  kernel: string | null;
}

export function parseBootCheck(stdout: string): BootNow {
  const s = splitSections(stdout);
  const first = (k: string) => s.get(k)?.[0]?.trim() || null;
  return { bootId: first("bootid"), kernel: first("kernel") };
}

/** Por qué el informe ya no refleja el servidor (null = nada que decir). */
export function staleReason(report: Report, now: BootNow): string | null {
  if (report.host.inContainer) return null;
  if (report.host.bootId && now.bootId && report.host.bootId !== now.bootId) {
    return "El servidor se reinició después de este análisis: lo arreglado o lo que solo esperaba el reinicio puede seguir en la lista.";
  }
  if (report.host.kernel && now.kernel && report.host.kernel !== now.kernel) {
    return `El kernel en uso cambió desde este análisis (${report.host.kernel} → ${now.kernel}).`;
  }
  return null;
}
