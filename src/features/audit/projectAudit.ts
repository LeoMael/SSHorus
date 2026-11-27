// «Auditar proyecto»: lo puro. Estado de cada servidor, los problemas más comunes entre servidores, el resumen
// del proyecto y una cola con un máximo de servidores a la vez. Se prueba en projectAudit.test.ts.
import type { AuditReport, CheckStatus } from "../../api/audit";

/** Servidores que se auditan a la vez. */
export const PROJECT_AUDIT_CONCURRENCY = 3;

export type ServerAuditStatus = "idle" | "queued" | "connecting" | "auditing" | "done" | "error" | "canceled";

/** Un servidor del proyecto en la auditoría. */
export interface ServerAuditRow {
  status: ServerAuditStatus;
  /** Paso en curso («Revisando puertos…»). */
  step: string | null;
  /** Por qué no se pudo (sin conexión, sudo…). */
  error: string | null;
  /** Informe de esta vez (si no, el último guardado). */
  report: AuditReport | null;
}

export const IDLE_ROW: ServerAuditRow = { status: "idle", step: null, error: null, report: null };

export const ROW_STATUS_TEXT: Record<ServerAuditStatus, string> = {
  idle: "",
  queued: "En cola",
  connecting: "Conectando…",
  auditing: "Auditando…",
  done: "Hecho",
  error: "No se pudo",
  canceled: "Cancelado",
};

export function rowBusy(r: ServerAuditRow | undefined): boolean {
  return !!r && (r.status === "queued" || r.status === "connecting" || r.status === "auditing");
}

/** Un servidor con su informe (el de ahora o el último guardado). */
export interface ServerAuditEntry {
  profileId: string;
  name: string;
  report: AuditReport | null;
}

/** Un problema que aparece en uno o más servidores. */
export interface CommonProblem {
  id: string;
  title: string;
  /** El peor estado entre servidores. */
  status: Extract<CheckStatus, "bad" | "warn">;
  weight: number;
  servers: string[];
}

/** Problemas (mal y aviso) agrupados por comprobación: primero los que salen en más servidores y los graves. */
export function commonProblems(entries: ServerAuditEntry[], limit = 8): CommonProblem[] {
  const by = new Map<string, CommonProblem>();
  for (const e of entries) {
    for (const c of e.report?.checks ?? []) {
      if (c.status !== "bad" && c.status !== "warn") continue;
      const p = by.get(c.id) ?? { id: c.id, title: c.title, status: c.status, weight: c.weight, servers: [] };
      if (c.status === "bad") p.status = "bad";
      p.weight = Math.max(p.weight, c.weight);
      if (!p.servers.includes(e.name)) p.servers.push(e.name);
      by.set(c.id, p);
    }
  }
  const rank = (p: CommonProblem) => (p.status === "bad" ? 10 : 0) + p.weight;
  return [...by.values()].sort((a, b) => b.servers.length - a.servers.length || rank(b) - rank(a) || a.title.localeCompare(b.title)).slice(0, limit);
}

export interface ProjectSummary {
  /** Servidores con informe. */
  audited: number;
  total: number;
  /** Media de las notas (null si ninguno tiene). */
  average: number | null;
  /** El de peor nota. */
  worst: { name: string; score: number } | null;
  /** Informes leídos sin sudo (incompletos). */
  noSudo: number;
}

export function projectSummary(entries: ServerAuditEntry[]): ProjectSummary {
  const scored = entries.filter((e): e is ServerAuditEntry & { report: AuditReport & { score: number } } => e.report?.score != null);
  const average = scored.length ? Math.round(scored.reduce((s, e) => s + e.report.score, 0) / scored.length) : null;
  const worst = scored.reduce<ProjectSummary["worst"]>((w, e) => (!w || e.report.score < w.score ? { name: e.name, score: e.report.score } : w), null);
  return {
    audited: entries.filter((e) => e.report).length,
    total: entries.length,
    average,
    worst,
    noSudo: entries.filter((e) => e.report && !e.report.elevated).length,
  };
}

/** Resumen de la tarea en una frase: «3 de 4 auditados · media 78/100 · 1 sin conexión». */
export function projectAuditSentence(rows: ServerAuditRow[]): string {
  const done = rows.filter((r) => r.status === "done");
  const scores = done.map((r) => r.report?.score).filter((s): s is number => typeof s === "number");
  const failed = rows.filter((r) => r.status === "error").length;
  const parts = [`${done.length} de ${rows.length} auditados`];
  if (scores.length) parts.push(`media ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}/100`);
  const noSudo = done.filter((r) => r.report && !r.report.elevated).length;
  if (noSudo) parts.push(`${noSudo} sin sudo`);
  if (failed) parts.push(`${failed} no se ${failed === 1 ? "pudo" : "pudieron"}`);
  return parts.join(" · ");
}

/**
 * Ejecuta `fn` para cada elemento, como mucho `limit` a la vez, en orden. Con `stopped()` verdadero no empieza
 * más (los que faltan se pasan a `skipped`). Nunca lanza: los errores de `fn` son cosa suya.
 */
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, stopped: () => boolean, skipped: (item: T) => void): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (stopped()) {
        skipped(item);
        continue;
      }
      await fn(item).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
