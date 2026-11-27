// Qué empeoró y qué mejoró entre dos auditorías del mismo servidor (para la auditoría programada). Usa las
// mismas reglas que las flechas de Administración → Auditoría (`compare` de score.ts) y añade los nombres, el
// estado de antes y de ahora y la nota. Puro; se prueba en auditDiff.test.ts.
import type { AuditReport, CheckStatus } from "../../api/audit";
import { compare } from "./score";

/** Una comprobación que cambió. `from` = null si antes no salía. */
export interface CheckChange {
  id: string;
  title: string;
  from: CheckStatus | null;
  to: CheckStatus;
  weight: number;
}

export interface AuditDiff {
  previousAt: string;
  currentAt: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** Una se hizo con sudo y la otra sin: la nota no es comparable (no cuenta para «empeoró»). */
  sudoChanged: boolean;
  /** De bien a aviso o mal, o de aviso a mal. */
  worse: CheckChange[];
  /** Problemas que antes no salían. */
  appeared: CheckChange[];
  /** De mal a aviso o bien, o de aviso a bien. */
  better: CheckChange[];
  worsened: boolean;
  improved: boolean;
}

/** Lo grave primero y, a igualdad, lo de más peso. */
function bySeverity(a: CheckChange, b: CheckChange): number {
  const rank = (c: CheckChange) => (c.to === "bad" ? 0 : c.to === "warn" ? 1 : 2);
  return rank(a) - rank(b) || b.weight - a.weight || a.title.localeCompare(b.title);
}

/** Compara `cur` con la auditoría anterior `prev` (null si no había: no hay nada que comparar). */
export function auditDiff(cur: AuditReport, prev: AuditReport | null): AuditDiff | null {
  const cmp = compare(cur, prev);
  if (!cmp || !prev) return null;
  const before = new Map(prev.checks.map((c) => [c.id, c.status]));
  const worse: CheckChange[] = [];
  const appeared: CheckChange[] = [];
  const better: CheckChange[] = [];
  for (const c of cur.checks) {
    const change = cmp.changes.get(c.id);
    if (!change) continue;
    const item: CheckChange = { id: c.id, title: c.title, from: before.get(c.id) ?? null, to: c.status, weight: c.weight };
    (change === "worse" ? worse : change === "new" ? appeared : better).push(item);
  }
  const sudoChanged = cur.elevated !== prev.elevated;
  const delta = sudoChanged ? null : cmp.scoreDelta;
  return {
    previousAt: prev.createdAt,
    currentAt: cur.createdAt,
    scoreBefore: prev.score,
    scoreAfter: cur.score,
    sudoChanged,
    worse: worse.sort(bySeverity),
    appeared: appeared.sort(bySeverity),
    better: better.sort(bySeverity),
    worsened: worse.length > 0 || appeared.length > 0 || (delta !== null && delta < 0),
    improved: better.length > 0 || (delta !== null && delta > 0),
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** En una línea: «Nota 82 → 74 · 2 empeoran · 1 problema nuevo · 1 mejora». */
export function diffSentence(d: AuditDiff): string {
  const parts: string[] = [];
  if (d.scoreBefore !== null && d.scoreAfter !== null && d.scoreBefore !== d.scoreAfter) parts.push(`nota ${d.scoreBefore} → ${d.scoreAfter}`);
  if (d.worse.length) parts.push(plural(d.worse.length, "empeora", "empeoran"));
  if (d.appeared.length) parts.push(plural(d.appeared.length, "problema nuevo", "problemas nuevos"));
  if (d.better.length) parts.push(plural(d.better.length, "mejora", "mejoran"));
  if (d.sudoChanged) parts.push("una de las dos sin sudo");
  const s = parts.join(" · ") || "sin cambios";
  return s[0].toUpperCase() + s.slice(1);
}
