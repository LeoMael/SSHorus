// ¿El servidor pide reiniciarse? Lo usan la auditoría (comprobación «Reinicio pendiente») y «Reiniciar
// ahora» (para comprobar al volver). Sin root. Funciones puras.
//
// Debian/Ubuntu: /var/run/reboot-required · RHEL/Fedora: needs-restarting -r (1 = hay que reiniciar) ·
// el resto: el núcleo en marcha ya no está en /lib/modules (se actualizó y se borró el viejo).

/** Líneas de sh (necesitan `$TO`, el `timeout` o vacío). Salida: «required», «nr N», «kernel X», «mod X». */
export const REBOOT_PENDING_LINES = [
  "[ -f /var/run/reboot-required ] && echo required",
  "if command -v needs-restarting >/dev/null 2>&1; then $TO needs-restarting -r >/dev/null 2>&1; echo \"nr $?\";",
  "elif command -v dnf >/dev/null 2>&1 && dnf needs-restarting --help >/dev/null 2>&1; then $TO dnf -q needs-restarting -r >/dev/null 2>&1; echo \"nr $?\"; fi",
  "echo \"kernel $(uname -r)\"; ls /lib/modules 2>/dev/null | sed 's/^/mod /'",
];

/** required = lo pide la distro · kernel-gone = el núcleo en marcha ya no está instalado · no · unknown. */
export type RebootPending = "required" | "kernel-gone" | "no" | "unknown";

export interface RebootPendingInfo {
  state: RebootPending;
  /** Núcleo en marcha (`uname -r`), si se leyó. */
  kernel: string | null;
}

/** Lee la salida de `REBOOT_PENDING_LINES` (líneas sin espacios sobrantes). */
export function rebootPending(lines: string[]): RebootPendingInfo {
  // Otro código (124 = se agotó el tiempo, dnf sin caché…) no dice nada: se mira el núcleo.
  const nr = lines.find((l) => l === "nr 0" || l === "nr 1");
  const kernel = lines.find((l) => l.startsWith("kernel "))?.slice(7).trim() || null;
  const mods = lines.filter((l) => l.startsWith("mod ")).map((l) => l.slice(4));
  let state: RebootPending = "unknown";
  if (lines.includes("required") || nr === "nr 1") state = "required";
  else if (nr === "nr 0" || (mods.length > 0 && kernel !== null && mods.includes(kernel) && !nr)) state = "no";
  else if (mods.length > 0 && kernel && !mods.includes(kernel)) state = "kernel-gone";
  return { state, kernel };
}
