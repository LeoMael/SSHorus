// Pruebas de la comparación entre dos auditorías (auditoría programada): qué empeora, qué es nuevo, qué
// mejora, la nota y el caso con y sin sudo.
import type { AuditReport, Check } from "../../api/audit";
import { auditDiff, diffSentence } from "./auditDiff";

declare const process: { exit(code: number): never };

let failed = 0;
let passed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

function chk(id: string, status: Check["status"], weight = 1): Check {
  return { id, category: "ssh", title: `t-${id}`, status, detail: "", items: [], fix: null, weight };
}
function report(score: number | null, checks: Check[], elevated = true, createdAt = "2026-11-02"): AuditReport {
  return { id: createdAt, serverId: "s", createdAt, durationMs: 0, elevated, os: "", score, grade: null, summary: "", categories: [], checks, ai: null };
}

const prev = report(90, [chk("a", "ok"), chk("b", "warn", 2), chk("c", "bad", 3), chk("d", "ok", 3), chk("e", "skip"), chk("f", "warn")], true, "2026-11-01");

eq(auditDiff(report(90, []), null), null, "sin auditoría anterior no hay nada que comparar");

// Igual: sin cambios, sin aviso.
const same = auditDiff(report(90, prev.checks), prev);
ok(same && !same.worsened && !same.improved, "igual: ni empeora ni mejora");
eq(same && diffSentence(same), "Sin cambios", "frase sin cambios");

// Empeora: ok→warn, warn→bad; nuevo: «g» no estaba; mejora: bad→ok. «e» (antes sin comprobar) no cuenta.
const cur = report(72, [chk("a", "warn"), chk("b", "bad", 2), chk("c", "ok", 3), chk("d", "bad", 3), chk("e", "bad"), chk("f", "warn"), chk("g", "warn", 2)]);
const d = auditDiff(cur, prev);
ok(d?.worsened, "empeoró");
ok(d?.improved, "y también mejoró algo");
eq(d?.worse.map((c) => `${c.id}:${c.from}→${c.to}`), ["d:ok→bad", "b:warn→bad", "a:ok→warn"], "lo que empeora, lo grave y de más peso primero");
eq(d?.appeared.map((c) => `${c.id}:${c.from}→${c.to}`), ["g:null→warn"], "problema nuevo");
eq(d?.better.map((c) => `${c.id}:${c.from}→${c.to}`), ["c:bad→ok"], "lo que mejora");
ok(!d?.worse.some((c) => c.id === "e"), "lo que antes no se pudo comprobar no cuenta como peor");
eq(d && [d.scoreBefore, d.scoreAfter, d.previousAt], [90, 72, "2026-11-01"], "notas y fecha de la anterior");
eq(d && diffSentence(d), "Nota 90 → 72 · 3 empeoran · 1 problema nuevo · 1 mejora", "frase");

// Solo baja la nota (p. ej. una categoría nueva con avisos que no salía): cuenta como peor.
const lower = auditDiff(report(85, prev.checks), prev);
ok(lower?.worsened && !lower.improved, "nota más baja = empeoró");
const higher = auditDiff(report(95, prev.checks), prev);
ok(higher?.improved && !higher.worsened, "nota más alta = mejoró");

// Una con sudo y otra sin: la nota no se compara (sin sudo se comprueba menos), los cambios sí.
const noSudo = auditDiff(report(70, prev.checks.map((c) => (c.id === "c" ? chk("c", "skip", 3) : c)), false), prev);
ok(noSudo && !noSudo.worsened && noSudo.sudoChanged, "sin sudo: la nota más baja no cuenta y lo no comprobado tampoco");
eq(noSudo && diffSentence(noSudo), "Nota 90 → 70 · una de las dos sin sudo", "frase con sudo distinto");
const noSudoWorse = auditDiff(report(70, prev.checks.map((c) => (c.id === "a" ? chk("a", "bad") : c)), false), prev);
ok(noSudoWorse?.worsened, "sin sudo, lo que sí se vio peor cuenta");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
