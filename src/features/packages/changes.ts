// Paquetes: los cambios (actualizar todo, solo seguridad, unos paquetes, instalar y quitar) listos para el
// diálogo de cambios de Administración: comando exacto, como root y como tarea en segundo plano con su
// salida en vivo y «Cancelar». Quitar algo crítico (SSH, sudo, systemd, el kernel…) pide confirmación
// escrita con un aviso fuerte. Funciones puras.
import { upgradeCommandFor } from "../vulnscan";
import type { ConfigChange } from "../serverConfig";
import { MANAGERS } from "./managers";
import type { PkgManager, Upgrade, UpdatesRead } from "./parse";
import { removalWarning, validPackage } from "./search";

/** Actualizar puede tardar mucho en un VPS pequeño. */
const UPGRADE_SECS = 1800;
const INSTALL_SECS = 900;

const REBOOT_NOTE = "Si se actualiza el kernel o algo como glibc o systemd, hará falta reiniciar el servidor para usarlo.";

function change(id: string, title: string, explain: string, steps: string[], o: Partial<ConfigChange> = {}): ConfigChange {
  return { id: `pkg:${id}`, label: title, title, explain, steps, danger: false, note: null, guardCheck: null, timeoutSecs: UPGRADE_SECS, ...o };
}

/** Actualizar todo lo pendiente. */
export function upgradeAllChange(m: PkgManager, count: number): ConfigChange | null {
  if (m === "none") return null;
  return change(
    "all",
    "Actualizar todos los paquetes",
    `Instala ${count ? `las ${count} actualizaciones pendientes` : "todas las actualizaciones pendientes"} con ${MANAGERS[m].label}, sin preguntas. Los servicios suelen seguir funcionando mientras tanto.`,
    [MANAGERS[m].upgradeAll],
    { note: REBOOT_NOTE },
  );
}

/** Solo las de seguridad: dnf/yum/zypper lo saben hacer; en apt se actualizan los paquetes marcados. */
export function upgradeSecurityChange(r: UpdatesRead): ConfigChange | null {
  if (r.manager === "none") return null;
  const row = MANAGERS[r.manager];
  if (row.upgradeSecurity) {
    return change("security", "Instalar solo las actualizaciones de seguridad", "Instala solo lo que la distribución marca como arreglo de seguridad; el resto queda para más tarde.", [row.upgradeSecurity], { note: REBOOT_NOTE });
  }
  const names = r.updates.filter((u) => u.security).map((u) => u.name);
  return upgradeSomeChange(r.manager, names, "Instalar solo las actualizaciones de seguridad");
}

/** Actualizar unos paquetes concretos (los mismos comandos que «Arreglar» del escáner). */
export function upgradeSomeChange(m: PkgManager, names: string[], title?: string): ConfigChange | null {
  if (m === "none") return null;
  const ok = names.filter(validPackage);
  const cmd = upgradeCommandFor(MANAGERS[m].family, ok);
  if (!cmd) return null;
  const label = title ?? (ok.length === 1 ? `Actualizar ${ok[0]}` : `Actualizar ${ok.length} paquetes`);
  return change(`some:${ok.join(",")}`.slice(0, 200), label, `Actualiza ${ok.length === 1 ? "este paquete" : `estos paquetes: ${ok.join(", ")}`} (y lo que necesiten), sin tocar el resto.`, [cmd], {
    timeoutSecs: INSTALL_SECS,
  });
}

/** Instalar un paquete. */
export function installChange(m: PkgManager, name: string): ConfigChange | null {
  if (m === "none" || !validPackage(name)) return null;
  return change(`install:${name}`, `Instalar ${name}`, `Instala ${name} y lo que necesite. Si trae un servicio, normalmente no se arranca solo: búscalo luego en «Servicios».`, [MANAGERS[m].install(name)], {
    timeoutSecs: INSTALL_SECS,
  });
}

/**
 * Quitar un paquete. `removed`: lo que la simulación dice que se quitaría (el paquete y lo que depende de
 * él); null si no se pudo simular. Si hay algo crítico, aviso fuerte y confirmación escrita.
 */
export function removeChange(m: PkgManager, name: string, removed: string[] | null, kernel: string | null): ConfigChange | null {
  if (m === "none" || !validPackage(name)) return null;
  const all = removed && removed.length ? removed : [name];
  const warn = removalWarning(all.includes(name) ? all : [name, ...all], kernel);
  const others = all.filter((n) => n !== name);
  const explain =
    removed === null
      ? `Quita ${name}. No se pudo comprobar antes qué más se quitaría con él: el gestor lo dirá en la salida.`
      : others.length
        ? `Quita ${name} y también ${others.length === 1 ? "este paquete, que depende de él" : `estos ${others.length}, que dependen de él o ya no hacen falta`}: ${others.join(", ")}.`
        : `Quita ${name}. No se quita nada más.`;
  return change(`remove:${name}`, `Quitar ${name}`, explain, [MANAGERS[m].remove(name)], {
    danger: !!warn,
    note: warn ?? "Su configuración suele quedarse en el servidor por si lo vuelves a instalar.",
    timeoutSecs: INSTALL_SECS,
  });
}

/** Paquetes del kernel entre las actualizaciones (para avisar de que hará falta reiniciar). */
export function kernelUpdates(list: Upgrade[]): Upgrade[] {
  return list.filter((u) => /^(kernel|linux-image|linux-lts|linux-virt)/.test(u.name));
}
