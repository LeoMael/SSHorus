// Filtros y filas de la tabla «Vulnerabilidades» (sin React): qué hallazgos se ven y cómo se agrupan
// los del kernel en una fila plegable.
import type { Finding, Report, Severity } from "../../api/vulnscan";
import { fixKind, type FixKind } from "./fixPlan";

export const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "unknown"];

export type VulnRow =
  | { kind: "f"; f: Finding; child: boolean }
  | { kind: "kernel"; items: Finding[]; worst: Severity; open: boolean };

export interface VulnFilters {
  severity: Severity | "all";
  /** Clave del objetivo (`Target.key`) o «all». */
  origin: string;
  onlyFix: boolean;
  fixFilter: FixKind | null;
  showUnimportant: boolean;
  query: string;
}

export const NO_FILTERS: VulnFilters = {
  severity: "all",
  origin: "all",
  onlyFix: false,
  fixFilter: null,
  showUnimportant: false,
  query: "",
};

/** Busca todas las palabras de `q` en el id, el paquete, las versiones, el resumen y los avisos. */
export function matchesVuln(f: Finding, q: string): boolean {
  if (!q) return true;
  const hay = [f.id, f.package, f.installed, f.fixed ?? "", f.summary ?? "", ...f.aliases, ...f.advisories, ...f.binaries].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function filterFindings(report: Report | null | undefined, all: Finding[], v: VulnFilters): Finding[] {
  const q = v.query.trim();
  return all.filter(
    (f) =>
      (v.showUnimportant || !f.unimportant) &&
      (v.severity === "all" || f.severity === v.severity) &&
      (v.origin === "all" || f.target === v.origin) &&
      (!v.onlyFix || f.hasFix) &&
      (!v.fixFilter || (!!report && fixKind(report, f) === v.fixFilter)) &&
      matchesVuln(f, q),
  );
}

/** ¿Hay algún filtro que «Quitar filtros» pueda deshacer? («sin importancia» no cuenta: es otra casilla). */
export function hasActiveFilters(v: VulnFilters): boolean {
  return !!v.query || v.severity !== "all" || v.origin !== "all" || v.onlyFix || !!v.fixFilter;
}

/** Los del kernel del sistema van juntos en una fila (con la peor gravedad) y, si está abierta, debajo. */
export function buildVulnRows(filtered: Finding[], kernelOpen: boolean): VulnRow[] {
  const isKernel = (f: Finding) => f.kernel && f.target === "system";
  const kernel = filtered.filter(isKernel);
  const out: VulnRow[] = [];
  if (kernel.length) {
    const worst = SEV_ORDER.find((s) => kernel.some((k) => k.severity === s)) ?? "unknown";
    out.push({ kind: "kernel", items: kernel, worst, open: kernelOpen });
    if (kernelOpen) for (const f of kernel) out.push({ kind: "f", f, child: true });
  }
  for (const f of filtered) if (!isKernel(f)) out.push({ kind: "f", f, child: false });
  return out;
}
