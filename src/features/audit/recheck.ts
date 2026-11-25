// Después de un arreglo: qué volver a comprobar, cómo cruzar el informe guardado con lo nuevo (y recalcular
// las notas) y, si algo sigue mal, por qué en una línea. Funciones puras: se prueban en fix.test.ts.
import type { AuditReport, CategoryId, Check, CheckStatus } from "../../api/audit";
import { splitSections } from "../../lib/remote";
import { CATEGORIES, scoreChecks } from "./score";

/** Categorías que cambian además de la propia (fail2ban depende de si SSH admite contraseña). */
const ALSO: Partial<Record<CategoryId, CategoryId[]>> = { ssh: ["logins"] };

/** Categorías que hay que volver a comprobar tras arreglar `fixed`. */
export function recheckCategories(fixed: Pick<Check, "category">[]): CategoryId[] {
  const out = new Set<CategoryId>();
  for (const c of fixed) {
    out.add(c.category);
    for (const x of ALSO[c.category] ?? []) out.add(x);
  }
  return CATEGORIES.map((c) => c.id).filter((id) => out.has(id));
}

/**
 * El informe guardado con las categorías `cats` cambiadas por las de la comprobación nueva, y las notas
 * recalculadas. Un «sin comprobar» nuevo no pisa un resultado de verdad (p. ej. si sudo falló al volver
 * a leer): se queda el anterior.
 */
export function mergeRecheck(report: AuditReport, fresh: Check[], cats: CategoryId[]): AuditReport {
  const set = new Set(cats);
  const old = new Map(report.checks.map((c) => [c.id, c]));
  const replaced = fresh
    .filter((c) => set.has(c.category))
    .map((c) => {
      const prev = old.get(c.id);
      return c.status === "skip" && prev && prev.status !== "skip" ? prev : c;
    });
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  const checks = [...report.checks.filter((c) => !set.has(c.category)), ...replaced].sort(
    (a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99),
  );
  const s = scoreChecks(checks);
  return { ...report, checks, score: s.score, grade: s.grade, summary: s.summary, categories: s.categories };
}

// ───────── Resultado de cada arreglo ─────────

export type RecheckState = "fixed" | "better" | "same" | "worse" | "unknown";

export interface RecheckOutcome {
  id: string;
  state: RecheckState;
  /** Una línea: por qué sigue mal (null si quedó arreglado). */
  reason: string | null;
}

const RANK: Partial<Record<CheckStatus, number>> = { ok: 0, info: 0, warn: 1, bad: 2 };

/** Opción de sshd y el valor que deja el arreglo. */
const SSHD_KEY: Record<string, { key: string; want: string }> = {
  "ssh.root": { key: "permitrootlogin", want: "no" },
  "ssh.password": { key: "passwordauthentication", want: "no" },
};

/**
 * Por qué una opción de sshd sigue mal: el archivo que la pone con otro valor. `stdout` es la salida de
 * AUDIT_SCRIPT tras el arreglo (los .conf de sshd_config.d primero, luego sshd_config).
 */
export function sshdCulprit(checkId: string, stdout: string): string | null {
  const opt = SSHD_KEY[checkId];
  if (!opt) return null;
  const set = (sec: string[]) =>
    sec
      .map((l) => /^([^:]+):\s*(\S+)\s+(\S+)/.exec(l))
      .filter((m): m is RegExpExecArray => !!m && m[2].toLowerCase() === opt.key)
      .map((m) => ({ file: m[1], value: m[3].toLowerCase() }));
  const lines = set(splitSections(stdout).get("sshdcfg") ?? []);
  const ours = lines.some((l) => l.file.endsWith("/00-sshorus.conf") && l.value === opt.want);
  const other = lines.filter((l) => !l.file.endsWith("/00-sshorus.conf") && l.value !== opt.want);
  // Si 00-sshorus.conf ya lo pone y no gana, lo pisa algo que sshd lee ANTES de los .conf: una línea de
  // sshd_config por encima de su «Include».
  const culprit = (ours && other.find((l) => !l.file.includes("/sshd_config.d/"))) || other[0];
  return culprit ? `otro archivo lo vuelve a activar: ${culprit.file}` : null;
}

/** Cómo quedó una comprobación tras su arreglo. */
export function recheckOutcome(before: Check, after: Check | undefined, stdout: string): RecheckOutcome {
  const id = before.id;
  if (!after) return { id, state: "unknown", reason: "ya no aparece en la comprobación" };
  if (after.status === "skip") return { id, state: "unknown", reason: `no se pudo volver a comprobar: ${after.detail}` };
  const a = RANK[after.status] ?? 0;
  const b = RANK[before.status] ?? 0;
  if (a === 0) return { id, state: "fixed", reason: null };
  if (a < b) return { id, state: "better", reason: `mejoró, pero queda: ${after.detail}` };
  if (a > b) return { id, state: "worse", reason: `empeoró: ${after.detail}` };
  const culprit = sshdCulprit(id, stdout);
  if (culprit) return { id, state: "same", reason: culprit };
  if (SSHD_KEY[id]) return { id, state: "same", reason: "sshd sigue igual: puede que un bloque «Match» lo cambie o que el «Include» esté al final de sshd_config" };
  return { id, state: "same", reason: `sigue igual: ${after.detail}` };
}

/** Texto corto de un resultado (para avisos y la fila). */
export function outcomeText(o: RecheckOutcome): string {
  if (o.state === "fixed") return "Arreglado";
  const r = o.reason ?? "";
  return r ? `${r[0].toUpperCase()}${r.slice(1)}` : "Sigue igual";
}

/** Resultado de unos arreglos en una frase: «2 arreglados · Nota 85/100 (B)», «1 arreglado, 1 sigue: …». */
export function fixSummary(outcomes: RecheckOutcome[], r: { score: number | null; grade: string | null; summary: string }): string {
  const fixed = outcomes.filter((o) => o.state === "fixed").length;
  const rest = outcomes.filter((o) => o.state !== "fixed");
  const f = `${fixed} ${fixed === 1 ? "arreglado" : "arreglados"}`;
  if (rest.length === 0) return `${f} · ${r.score !== null ? `Nota ${r.score}/100 (${r.grade ?? "?"})` : r.summary}`;
  return `${f}, ${rest.length} ${rest.length === 1 ? "sigue" : "siguen"}: ${outcomeText(rest[0])}`;
}
