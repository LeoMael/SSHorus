// Después de arreglar: qué se arregló y qué sigue (y por qué), cruzando lo que se quiso arreglar con el
// informe nuevo. Funciones puras, sin React ni Tauri.
import type { Finding, Report } from "../../api/vulnscan";
import { targetOf } from "./fixCommand";
import { repoFix } from "./repo";

/** Por qué sigue una vulnerabilidad. */
export type StayReason = "reboot" | "nofix" | "norepo" | "notUpdated" | "stillAffected" | "otherSource";

export const STAY_TEXT: Record<StayReason, string> = {
  reboot: "Falta reiniciar el servidor (kernel nuevo instalado)",
  nofix: "Todavía no hay versión corregida",
  norepo: "Sin versión corregida en tus repositorios todavía",
  notUpdated: "No se actualizó (mira la salida: puede que tus repositorios aún no tengan la corregida)",
  stillAffected: "Se actualizó, pero la versión nueva sigue afectada",
  otherSource: "Viene de otra fuente (imagen o programa suelto)",
};

export interface Remaining {
  f: Finding;
  reason: StayReason;
}

export interface CrossResult {
  fixed: Finding[];
  remaining: Remaining[];
}

function stayReason(next: Report, before: Finding, now: Finding): StayReason {
  if (now.needsReboot) return "reboot";
  const t = targetOf(next, now);
  if (t?.kind === "image" || t?.kind === "runtime" || now.upstream) return "otherSource";
  if (!now.hasFix) return "nofix";
  // Informes viejos guardaban la versión sin epoch: «1:3.0.7» y «3.0.7» son la misma.
  const same = now.installed.replace(/^\d+:/, "") === before.installed.replace(/^\d+:/, "");
  if (!same) return "stillAffected";
  return repoFix(next, now) === "no" ? "norepo" : "notUpdated";
}

/** Cruza `scope` (lo que había antes) con el informe nuevo. */
export function crossReports(scope: Finding[], next: Report): CrossResult {
  const byKey = new Map(next.findings.map((f) => [f.key, f]));
  const out: CrossResult = { fixed: [], remaining: [] };
  for (const f of scope) {
    const now = byKey.get(f.key);
    if (now) out.remaining.push({ f: now, reason: stayReason(next, f, now) });
    else out.fixed.push(f);
  }
  return out;
}

/** «Arreglado: 3 · Siguen: 1». */
export function crossSummary(r: CrossResult): string {
  return `Arreglado: ${r.fixed.length} · Siguen: ${r.remaining.length}`;
}

/** Lo que sigue agrupado por motivo, con los paquetes de cada uno (para mostrarlo corto). */
export function byReason(remaining: Remaining[]): { reason: StayReason; count: number; packages: string[] }[] {
  const order: StayReason[] = ["reboot", "norepo", "notUpdated", "stillAffected", "nofix", "otherSource"];
  return order
    .map((reason) => {
      const items = remaining.filter((r) => r.reason === reason);
      return { reason, count: items.length, packages: [...new Set(items.map((r) => r.f.package))] };
    })
    .filter((g) => g.count > 0);
}
