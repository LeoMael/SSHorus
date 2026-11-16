// «Arreglar»: en qué grupo va cada hallazgo y el comando ÚNICO que actualiza los paquetes de la distro.
// El comando corre como root (SSHorus lo eleva con la contraseña de sudo guardada) y sin preguntas
// (-y / --non-interactive): no hay terminal para contestar. Funciones puras, sin React ni Tauri.
import type { Finding, Report, Severity } from "../../api/vulnscan";
import { distroFamily, packagesOf, targetOf } from "./fixCommand";

/**
 * - `now`: tiene versión corregida y la trae el gestor de paquetes de la distro.
 * - `reboot`: el kernel nuevo ya está instalado; solo falta reiniciar.
 * - `nofix`: aún no hay versión corregida.
 * - `image`: está dentro de una imagen de contenedor («Actualizar imagen»).
 * - `manual`: programa suelto o gestor de paquetes desconocido (a mano).
 */
export type FixKind = "now" | "reboot" | "nofix" | "image" | "manual";

export type FixGroups = Record<FixKind, Finding[]>;

type Family = ReturnType<typeof distroFamily>;

/** Comando de actualización por familia, como root y sin preguntas. `p` = paquetes ya validados. */
const UPGRADE: Partial<Record<Family, (p: string) => string>> = {
  apt: (p) =>
    "apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --only-upgrade " +
    `-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold ${p}`,
  "rpm-dnf": (p) => `dnf upgrade -y --refresh ${p}`,
  "rpm-yum": (p) => `yum update -y ${p}`,
  suse: (p) => `zypper --non-interactive refresh && zypper --non-interactive update ${p}`,
  apk: (p) => `apk update && apk upgrade ${p}`,
};

/** ¿SSHorus sabe actualizar paquetes en esta distro? */
export function canUpgrade(report: Report): boolean {
  return !!UPGRADE[distroFamily(report)];
}

export function fixKind(report: Report, f: Finding): FixKind {
  if (f.needsReboot) return "reboot";
  const t = targetOf(report, f);
  if (t?.kind === "image") return "image";
  if (t?.kind === "runtime" || f.upstream) return "manual";
  if (!f.hasFix) return "nofix";
  return canUpgrade(report) && packagesOf(f).length > 0 ? "now" : "manual";
}

/** Reparte los hallazgos (sin los «sin importancia», como el resumen). */
export function groupFindings(report: Report, findings: Finding[]): FixGroups {
  const g: FixGroups = { now: [], reboot: [], nofix: [], image: [], manual: [] };
  for (const f of findings) if (!f.unimportant) g[fixKind(report, f)].push(f);
  return g;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

/** Un paquete que se puede elegir en «Arreglar»: el paquete fuente con sus binarios instalados. */
export interface PackageChoice {
  /** Paquete fuente (lo que se muestra). */
  name: string;
  /** Binarios que se actualizan. */
  binaries: string[];
  findings: Finding[];
  worst: Severity;
  kernel: boolean;
}

/** Los hallazgos `now` agrupados por paquete, primero los más graves. */
export function packageChoices(findings: Finding[]): PackageChoice[] {
  const map = new Map<string, PackageChoice>();
  for (const f of findings) {
    const key = `${f.target}|${f.package}`;
    const c = map.get(key) ?? { name: f.package, binaries: [], findings: [], worst: f.severity, kernel: f.kernel };
    for (const b of packagesOf(f)) if (!c.binaries.includes(b)) c.binaries.push(b);
    c.findings.push(f);
    if (SEV_RANK[f.severity] < SEV_RANK[c.worst]) c.worst = f.severity;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => SEV_RANK[a.worst] - SEV_RANK[b.worst] || b.findings.length - a.findings.length || a.name.localeCompare(b.name));
}

/** Un solo comando (como root) que actualiza todos esos paquetes. null si no hay nada o no se sabe. */
export function upgradeCommand(report: Report, binaries: string[]): string | null {
  const make = UPGRADE[distroFamily(report)];
  const pkgs = [...new Set(binaries)].sort();
  return make && pkgs.length ? make(pkgs.join(" ")) : null;
}

