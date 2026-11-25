// Resultado de «Arreglar» paquete por paquete, diciendo la verdad: cruza lo que se quiso arreglar con el
// informe nuevo (tras volver a comprobar), la salida de dnf/apt y los servicios que hay que reiniciar.
// Antes, «Nothing to do» (código 0) contaba como éxito aunque no se instalara nada. Funciones puras.
import type { Finding, Report } from "../../api/vulnscan";
import { noRepoText, repoFix } from "./repo";
import type { RestartInfo } from "./restart";

export type OutcomeStatus = "fixed" | "restart" | "reboot" | "norepo" | "partial" | "failed";

export const OUTCOME_TEXT: Record<OutcomeStatus, string> = {
  fixed: "Arreglado",
  restart: "Instalado, falta reiniciar servicios",
  reboot: "Instalado, falta reiniciar el servidor",
  norepo: "Sin versión corregida en tus repos todavía",
  partial: "Actualizado, pero sigue afectado",
  failed: "Falló",
};

const ORDER: OutcomeStatus[] = ["failed", "norepo", "partial", "reboot", "restart", "fixed"];

export interface PackageOutcome {
  package: string;
  status: OutcomeStatus;
  /** Por qué, en una línea (la de dnf si la hay). */
  detail: string | null;
  /** Vulnerabilidades del paquete que se fueron / que había. */
  fixed: number;
  total: number;
}

export interface UpgradeIssues {
  /** Línea de la salida que habla de cada paquete (no encontrado, excluido, conflicto…). */
  byPackage: Record<string, string>;
  /** Primera línea de error general («Error:», «Problem:», «E: »…). */
  general: string | null;
  /** dnf / zypper respondieron «Nothing to do». */
  nothingToDo: boolean;
}

/** Líneas que nombran un paquete (el primer grupo es su nombre o su NEVRA). */
const PKG_LINES = [
  /No match for argument:\s*(\S+)/,
  /All matches were filtered out by (?:exclude|modular) filtering for argument:\s*(\S+)/,
  /Package\s+(\S+).* is filtered out by (?:exclude|modular) filtering/,
  /cannot install the best update candidate for package\s+(\S+)/,
  /package\s+(\S+) (?:is filtered out|conflicts|requires|from .* is excluded)/,
  /^E: (?:Unable to locate package |Package '?)([^'\s]+)/,
];
const GENERAL = /^\s*(Error:\s*\S.*|Problem( \d+)?:.*|E: .*|Failed to download metadata.*|Curl error.*|Cannot (?:download|retrieve) .*)$/;
const NOTHING = /^\s*Nothing to do\.?\s*$/;

/** Paquete de `packages` al que se refiere `token` («openssl-libs-1:3.0.7-28.el9.x86_64» → openssl-libs). */
function packageIn(token: string, packages: string[]): string | null {
  const t = token.replace(/^['"]|['"]$/g, "");
  let best: string | null = null;
  for (const p of packages) {
    const exact = t === p || t.startsWith(`${p}.`);
    const nevra = t.startsWith(`${p}-`) && /^\d/.test(t.slice(p.length + 1));
    if ((exact || nevra) && (!best || p.length > best.length)) best = p;
  }
  return best;
}

/** Lo que dice la salida de la actualización sobre cada paquete. */
export function upgradeIssues(output: string, packages: string[]): UpgradeIssues {
  const out: UpgradeIssues = { byPackage: {}, general: null, nothingToDo: false };
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (NOTHING.test(line)) out.nothingToDo = true;
    for (const re of PKG_LINES) {
      const m = re.exec(line);
      const p = m ? packageIn(m[1], packages) : null;
      if (p && !out.byPackage[p]) out.byPackage[p] = line;
    }
    if (!out.general && GENERAL.test(line) && !/^Error:\s*$/.test(line)) out.general = line;
  }
  return out;
}

const bare = (v: string) => v.replace(/^\d+:/, "");

function outcomeOf(before: Finding[], next: Report, restart: RestartInfo | null, issues: UpgradeIssues, failure: string | null): Omit<PackageOutcome, "package"> {
  const byKey = new Map(next.findings.map((f) => [f.key, f]));
  const left = before.flatMap((f) => {
    const now = byKey.get(f.key);
    return now ? [{ was: f, now }] : [];
  });
  const total = before.length;
  const fixed = total - left.length;
  const base = { fixed, total };
  if (!left.length) {
    return restart?.services.length
      ? { ...base, status: "restart", detail: `Hay servicios con la versión vieja en memoria hasta reiniciarlos: ${restart.services.slice(0, 4).join(", ")}${restart.services.length > 4 ? "…" : ""}` }
      : { ...base, status: "fixed", detail: null };
  }
  if (left.every((x) => x.now.needsReboot)) {
    return { ...base, status: "reboot", detail: `Kernel nuevo instalado (${next.host.rebootKernel ?? left[0].now.fixed ?? "más nuevo"}): se usa al reiniciar` };
  }
  const names = [...new Set(before.flatMap((f) => [...f.binaries, f.package]))];
  const line = names.map((n) => issues.byPackage[n]).find(Boolean);
  if (line) return { ...base, status: "failed", detail: line };
  const changed = left.some((x) => bare(x.now.installed) !== bare(x.was.installed));
  const first = left.find((x) => !x.now.needsReboot)?.now ?? left[0].now;
  if (!changed && failure) return { ...base, status: "failed", detail: issues.general ?? failure };
  if (!changed) {
    const detail =
      repoFix(next, first) === "no"
        ? noRepoText(next, first)
        : issues.nothingToDo
          ? "El gestor de paquetes dijo «Nothing to do»: tus repositorios no traen una versión más nueva"
          : "La versión instalada no cambió: tus repositorios aún no traen la corregida";
    return { ...base, status: "norepo", detail };
  }
  return {
    ...base,
    status: "partial",
    detail: `Se actualizó a ${first.installed}, pero la corregida es ${first.fixed ?? "más nueva"}: aún no está en tus repositorios`,
  };
}

/**
 * Una fila por paquete de `scope` (lo que había antes de arreglar). `failure`: texto del error si el
 * comando terminó mal (sin él, «no cambió» es «sin versión corregida»).
 */
export function fixOutcomes(scope: Finding[], next: Report, restart: RestartInfo | null, issues: UpgradeIssues, failure: string | null): PackageOutcome[] {
  const groups = new Map<string, Finding[]>();
  for (const f of scope) {
    const k = `${f.target}|${f.package}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return [...groups.values()]
    .map((list) => ({ package: list[0].package, ...outcomeOf(list, next, restart, issues, failure) }))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.package.localeCompare(b.package));
}

/** «Arreglado: 2 · Sin versión corregida en tus repos todavía: 1» (paquetes; solo lo que hay). */
export function outcomeSummary(list: PackageOutcome[]): string {
  const parts = [...ORDER].reverse().flatMap((s) => {
    const n = list.filter((o) => o.status === s).length;
    return n ? [`${OUTCOME_TEXT[s]}: ${n}`] : [];
  });
  return parts.length ? parts.join(" · ") : "Nada que arreglar";
}

/** ¿Se instaló algo? Si no (todo falló o no había versión corregida), la tarea no terminó bien. */
export function nothingInstalled(list: PackageOutcome[]): boolean {
  return list.length > 0 && list.every((o) => o.status === "failed" || o.status === "norepo");
}
