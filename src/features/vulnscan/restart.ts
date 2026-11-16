// Tras actualizar paquetes: qué servicios siguen usando la versión vieja (hay que reiniciarlos) y si el
// servidor pide reiniciarse. Usa lo que tenga la distro: `needrestart` (Debian/Ubuntu),
// `needs-restarting` (dnf4 / yum-utils) o `dnf5 needs-restarting`. Si no hay ninguno, no se sabe.
// Script (solo lectura) y lectura de su salida: funciones puras.
import { splitSections } from "../admin/parse";

// dnf5 sin -C baja metadatos de los repositorios (más de 2 minutos medido): -C usa la caché, y cada
// herramienta tiene su límite de tiempo por si acaso.
export const RESTART_CHECK_SCRIPT = `PATH=$PATH:/usr/sbin:/sbin; export PATH; LC_ALL=C; export LC_ALL
T=; command -v timeout >/dev/null 2>&1 && T="timeout 60"
echo @@tool
if command -v needrestart >/dev/null 2>&1; then echo needrestart
elif command -v needs-restarting >/dev/null 2>&1; then echo needs-restarting
elif command -v dnf5 >/dev/null 2>&1; then echo dnf5
fi
echo @@services
if command -v needrestart >/dev/null 2>&1; then $T needrestart -b -r l 2>/dev/null | sed -n 's/^NEEDRESTART-SVC: *//p'
elif command -v needs-restarting >/dev/null 2>&1; then $T needs-restarting -s 2>/dev/null
elif command -v dnf5 >/dev/null 2>&1; then $T dnf5 -q -C needs-restarting -s 2>/dev/null
fi
echo @@reboot
if [ -f /var/run/reboot-required ]; then echo yes
elif command -v needrestart >/dev/null 2>&1; then
  k=$($T needrestart -b -r l 2>/dev/null | sed -n 's/^NEEDRESTART-KSTA: *//p')
  [ "$k" = 2 ] || [ "$k" = 3 ] && echo yes
elif command -v needs-restarting >/dev/null 2>&1; then $T needs-restarting -r >/dev/null 2>&1; [ $? -eq 1 ] && echo yes
elif command -v dnf5 >/dev/null 2>&1; then $T dnf5 -q -C needs-restarting -r >/dev/null 2>&1; [ $? -eq 1 ] && echo yes
fi
echo @@end
`;

/** Nombre de unidad de systemd seguro para el shell. */
const UNIT = /^[A-Za-z0-9][A-Za-z0-9@._:-]*$/;

/** Servicios que no se reinician sueltos (se cae la sesión o el sistema): mejor reiniciar el servidor. */
const NO_SINGLE_RESTART = /^(dbus|dbus-broker|systemd-[a-z-]+|user@\d+|getty@.*|serial-getty@.*|polkit)\.service$/;

export interface RestartInfo {
  /** Herramienta usada (null = ninguna: no se sabe qué servicios reiniciar). */
  tool: string | null;
  /** Servicios que se pueden reiniciar con un botón. */
  services: string[];
  /** Hay que reiniciar el servidor (lo pide la distro, el kernel o un servicio que no se reinicia suelto). */
  reboot: boolean;
}

export function parseRestart(stdout: string): RestartInfo {
  const s = splitSections(stdout);
  const tool = s.get("tool")?.[0]?.trim() || null;
  const units = (s.get("services") ?? [])
    .map((l) => l.trim())
    .filter((u) => UNIT.test(u))
    .map((u) => (u.includes(".") ? u : `${u}.service`));
  const services = [...new Set(units)].filter((u) => !NO_SINGLE_RESTART.test(u)).sort();
  const reboot = (s.get("reboot") ?? []).some((l) => l.trim() === "yes") || units.some((u) => NO_SINGLE_RESTART.test(u));
  return { tool, services, reboot };
}

/** Comando (como root) para reiniciar un servicio. null si el nombre no es seguro. */
export function restartCommand(unit: string): string | null {
  return UNIT.test(unit) ? `systemctl restart ${unit}` : null;
}
