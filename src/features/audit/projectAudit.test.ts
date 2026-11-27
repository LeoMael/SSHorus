// Pruebas de «Auditar proyecto»: problemas comunes entre servidores, resumen, la frase de la tarea y la cola
// con un máximo de servidores a la vez.
import type { AuditReport, Check } from "../../api/audit";
import { commonProblems, projectAuditSentence, projectSummary, runPool, type ServerAuditEntry, type ServerAuditRow } from "./projectAudit";

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
function report(score: number | null, checks: Check[], elevated = true): AuditReport {
  return { id: "r", serverId: "s", createdAt: "", durationMs: 0, elevated, os: "", score, grade: score === null ? null : "B", summary: "", categories: [], checks, ai: null };
}

const entries: ServerAuditEntry[] = [
  { profileId: "a", name: "web1", report: report(80, [chk("ssh.root", "warn", 3), chk("net.fw", "bad", 3), chk("x", "ok")]) },
  { profileId: "b", name: "web2", report: report(60, [chk("ssh.root", "bad", 3), chk("upd", "warn", 1)], false) },
  { profileId: "c", name: "db", report: report(90, [chk("upd", "warn", 1), chk("ssh.root", "warn", 3)]) },
  { profileId: "d", name: "nuevo", report: null },
];

const common = commonProblems(entries);
eq(common.map((p) => p.id), ["ssh.root", "upd", "net.fw"], "primero el que sale en más servidores; a igualdad, los graves");
eq(common[0].status, "bad", "el peor estado entre servidores");
eq(common[0].servers, ["web1", "web2", "db"], "en qué servidores");
ok(!common.some((p) => p.id === "x"), "lo que está bien no cuenta");
eq(commonProblems(entries, 1).length, 1, "límite");

const sum = projectSummary(entries);
eq(sum, { audited: 3, total: 4, average: 77, worst: { name: "web2", score: 60 }, noSudo: 1 }, "resumen del proyecto");
eq(projectSummary([]).average, null, "sin informes no hay media");

const row = (status: ServerAuditRow["status"], r: AuditReport | null = null): ServerAuditRow => ({ status, step: null, error: null, report: r });
eq(projectAuditSentence([row("done", report(80, [])), row("done", report(61, [], false)), row("error")]), "2 de 3 auditados · media 71/100 · 1 sin sudo · 1 no se pudo", "frase de la tarea");

// ── Cola: como mucho 2 a la vez, en orden, y «Cancelar» no empieza más ──
async function pool() {
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  await runPool(
    [1, 2, 3, 4, 5],
    2,
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      order.push(n);
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 5));
      active--;
      if (n === 3) throw new Error("falla uno");
    },
    () => false,
    () => undefined,
  );
  eq(peak, 2, "nunca más de 2 a la vez");
  eq(order, [1, 2, 3, 4, 5], "empiezan en orden y uno que falla no para a los demás");

  let stop = false;
  const ran: number[] = [];
  const skipped: number[] = [];
  await runPool(
    [1, 2, 3, 4],
    1,
    async (n) => {
      ran.push(n);
      if (n === 2) stop = true;
    },
    () => stop,
    (n) => skipped.push(n),
  );
  eq(ran, [1, 2], "tras cancelar no empieza más");
  eq(skipped, [3, 4], "los que faltan quedan cancelados");
}

void pool().then(() => {
  console.log(`${passed} pruebas bien, ${failed} mal`);
  if (failed) process.exit(1);
});
