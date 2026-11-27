// Paquetes: resultados de una búsqueda (`dnf search`, `apt-cache search`, `zypper search`, `apk search`),
// cuáles están ya instalados y qué se quitaría de verdad al quitar uno (simulación). Funciones puras.
import type { PkgManager } from "./parse";

export interface Found {
  name: string;
  summary: string;
  /** null = aún no se sabe (se pregunta aparte). */
  installed: boolean | null;
}

/** Nombre de paquete aceptado para buscar, instalar o quitar (sin espacios ni nada que el shell interprete). */
export const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export function validPackage(name: string): boolean {
  return PKG_RE.test(name);
}

const MAX_RESULTS = 150;

function dedupe(list: Found[]): Found[] {
  const seen = new Map<string, Found>();
  for (const f of list) if (!seen.has(f.name)) seen.set(f.name, f);
  return [...seen.values()].slice(0, MAX_RESULTS);
}

/** Salida de la búsqueda según el gestor. */
export function parseSearch(manager: PkgManager, lines: string[]): Found[] {
  const out: Found[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if (manager === "dnf" || manager === "yum") {
      // dnf 4: «nginx.x86_64 : resumen»; dnf 5: « nginx.x86_64<TAB>resumen».
      m = /^\s*([A-Za-z0-9_.+-]+)\.([a-z0-9_]+)\s*(?:\s:\s|\t)\s*(.*)$/.exec(line);
      if (m) out.push({ name: m[1], summary: m[3].trim(), installed: null });
    } else if (manager === "apt") {
      m = /^(\S+) - (.*)$/.exec(line);
      if (m) out.push({ name: m[1], summary: m[2].trim(), installed: null });
    } else if (manager === "zypper") {
      const cols = line.split("|").map((c) => c.trim());
      if (cols.length >= 4 && cols[1] && cols[1] !== "Name" && !/^-+$/.test(cols[1]) && (cols[3] ?? "package") === "package") {
        out.push({ name: cols[1], summary: cols[2], installed: /i/.test(cols[0]) });
      }
    } else if (manager === "apk") {
      m = /^(.+)-[^-]+-r\d+ - (.*)$/.exec(line);
      if (m) out.push({ name: m[1], summary: m[2].trim(), installed: null });
    }
  }
  return dedupe(out.filter((f) => validPackage(f.name)));
}

/** Nombres instalados según la comprobación aparte (una línea por paquete instalado). */
export function markInstalled(list: Found[], installedLines: string[]): Found[] {
  const set = new Set(installedLines.map((l) => l.trim()).filter(Boolean));
  return list.map((f) => (f.installed === null ? { ...f, installed: set.has(f.name) } : f));
}

/**
 * Lo que se quitaría al quitar el paquete (salida de la simulación). dnf: secciones «Removing…»;
 * apt: líneas «Remv nombre [versión]»; zypper: «…going to be REMOVED:» y los nombres debajo; apk:
 * «(1/3) Purging nombre (versión)».
 */
export function parseRemoval(manager: PkgManager, lines: string[]): string[] {
  const out: string[] = [];
  if (manager === "apt") {
    for (const l of lines) {
      const m = /^Remv (\S+)/.exec(l);
      if (m) out.push(m[1]);
    }
  } else if (manager === "apk") {
    for (const l of lines) {
      const m = /Purging (\S+)/.exec(l);
      if (m) out.push(m[1]);
    }
  } else if (manager === "zypper") {
    let on = false;
    for (const l of lines) {
      if (/going to be REMOVED:/.test(l)) on = true;
      else if (on && l.trim() === "") on = false;
      else if (on) out.push(...l.trim().split(/\s+/));
    }
  } else if (manager === "dnf" || manager === "yum") {
    let on = false;
    for (const l of lines) {
      const t = l.trim();
      if (/^Removing( dependent packages| unused dependencies| for dependencies)?:$/i.test(t)) on = true;
      else if (/^Transaction Summary/i.test(t)) break;
      else if (/^[A-Z]/.test(l)) on = false;
      // Un nombre largo parte la línea: la segunda empieza por la arquitectura y no es un paquete.
      else if (on && /^\s+\S/.test(l) && !/^(x86_64|noarch|aarch64|i686|ppc64le|s390x|armv7hl)\b/.test(t)) out.push(t.split(/\s+/)[0]);
    }
  }
  // apt puede poner la arquitectura («libfoo:amd64»).
  return [...new Set(out.map((n) => n.replace(/:[a-z0-9]+$/, "")).filter(validPackage))];
}

/**
 * El gestor se niega a quitarlo (dnf: «protected packages», como sudo, systemd o el kernel en uso; apt:
 * «Essential»): el motivo en palabras, o null.
 */
export function removalBlocked(lines: string[]): string | null {
  const text = lines.join("\n");
  const prot = /removing the following protected packages:\s*([^\n]+)/i.exec(text);
  if (prot) return `El gestor de paquetes no deja quitarlo: ${prot[1].trim()} es un paquete protegido del sistema.`;
  if (/WARNING: The following essential packages will be removed/i.test(text)) return "apt avisa de que se quitarían paquetes esenciales del sistema: no se ofrece quitarlo desde aquí.";
  return null;
}

/** Paquetes sin los que el servidor deja de arrancar, de dejarte entrar o de poder instalar nada. */
const CRITICAL_RE =
  /^(openssh(-server|-clients)?|ssh|sudo|doas|systemd(-libs|-udev|-sysv)?|udev|glibc|libc6|musl|bash|dash|coreutils|util-linux|shadow(-utils)?|passwd|login|pam|libpam.*|dnf|dnf5|yum|rpm|apt|dpkg|apk-tools|zypper|libzypp|busybox|alpine-baselayout|openssl-libs|libssl\d*|selinux-policy.*|grub2.*|grub-.*|kernel.*|linux-image.*|linux-generic.*|linux-lts|linux-virt)$/;

export function isCriticalPackage(name: string): boolean {
  return CRITICAL_RE.test(name);
}

/** Aviso fuerte si se quitaría algo crítico (null si no). `kernel` = `uname -r`. */
export function removalWarning(names: string[], kernel: string | null): string | null {
  const crit = names.filter(isCriticalPackage);
  if (!crit.length) return null;
  const kern = crit.some((n) => /^(kernel|linux-)/.test(n));
  return (
    `Se quitaría${crit.length > 1 ? "n" : ""} ${crit.join(", ")}: ` +
    "sin ellos el servidor puede no arrancar, no dejarte entrar por SSH o no poder instalar nada más." +
    (kern ? ` Uno puede ser el kernel en uso${kernel ? ` (${kernel})` : ""}.` : "")
  );
}
