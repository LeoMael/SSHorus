// ¿Los repositorios del servidor ya traen la versión corregida? Lo decide el motor con `dnf check-update`
// (src-tauri/src/vulnscan/repo.rs); en otras distros, o en informes viejos, no se sabe. Funciones puras.
import type { Finding, Report } from "../../api/vulnscan";

export type RepoFix = "yes" | "no" | "unknown";

export function repoFix(report: Report, f: Finding): RepoFix {
  if (!report.host.repoUpgrades || f.target !== "system" || !f.hasFix || f.needsReboot) return "unknown";
  return report.host.noRepoFix?.includes(f.key) ? "no" : "yes";
}

/** Lo más nuevo que ofrecen los repositorios para los paquetes del hallazgo («openssl-libs 1:3.2.2-6.el9_5»). */
export function repoOffers(report: Report, f: Finding): string[] {
  const up = report.host.repoUpgrades;
  return up ? f.binaries.flatMap((b) => (up[b] ? [`${b} ${up[b]}`] : [])) : [];
}

/** ¿El paquete es de un módulo de dnf («…module+el9.4.0+…»)? Su arreglo puede estar en otro stream. */
export function fromModule(f: Finding): boolean {
  return /\.module\+/.test(f.installed);
}

/** Texto corto para cuando la versión corregida aún no está en los repositorios. */
export function noRepoText(report: Report, f: Finding): string {
  const offers = repoOffers(report, f);
  return offers.length
    ? `Tus repositorios solo llegan a ${offers.join(", ")}; la corregida es ${f.fixed ?? "más nueva"}.`
    : `Tus repositorios no traen ninguna versión nueva de ${f.package} (la corregida es ${f.fixed ?? "más nueva"}).`;
}
