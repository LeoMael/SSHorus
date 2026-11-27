// Pruebas de la auditoría programada: cuándo toca, puesta al día (una sola vez), qué servidores entran, lo
// guardado, bloqueo y la nota de cómo fue.
import {
  EVERY_MS,
  LOCKED_NOTE,
  canceledKeys,
  chooseEvery,
  dueNow,
  isDue,
  keyServers,
  markRun,
  markSkipped,
  nextRunAt,
  outcomeNote,
  parseKey,
  parseSchedules,
  planTick,
  pruneSchedules,
  scheduleKey,
  worsenedChanges,
  type Schedules,
  type ServerOutcome,
} from "./schedule";
import type { AuditDiff } from "./auditDiff";

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

const DAY = EVERY_MS.day;
const T0 = Date.UTC(2026, 10, 1, 9, 0);

// ───────── Claves ─────────
eq(scheduleKey("server", "abc"), "server:abc", "clave de servidor");
eq(parseKey("project:p:1"), { kind: "project", id: "p:1" }, "el id puede llevar «:»");
eq(parseKey("otra:x"), null, "tipo desconocido");
eq(parseKey("server:"), null, "sin id");

// ───────── Cuándo toca ─────────
const daily = { every: "day" as const, lastRun: T0, note: null };
eq(nextRunAt(daily, T0), T0 + DAY, "cada día: 24 h después");
ok(!isDue(daily, T0 + DAY - 1), "un poco antes no toca");
ok(isDue(daily, T0 + DAY), "a las 24 h toca");
ok(!isDue({ ...daily, every: "week" }, T0 + 6 * DAY), "cada semana: a los 6 días no toca");
ok(isDue({ ...daily, every: "week" }, T0 + 7 * DAY), "a los 7 días sí");
ok(isDue({ every: "day", lastRun: null, note: null }, T0), "sin ninguna hecha toca ya");

// Elegir: cuenta desde la última auditoría que ya hay; cambiar el intervalo no reinicia la cuenta.
eq(chooseEvery(undefined, "day", T0 - 3600_000), { every: "day", lastRun: T0 - 3600_000, note: null }, "desde la última auditoría");
eq(chooseEvery(undefined, "week", null), { every: "week", lastRun: null, note: null }, "nunca auditado: toca ya");
eq(chooseEvery({ every: "day", lastRun: T0, note: "Sin cambios" }, "week", null), { every: "week", lastRun: T0, note: "Sin cambios" }, "cambiar el intervalo");

// ───────── Qué servidores entran ─────────
const projects = [
  { id: "p1", serverIds: ["a", "b", "zombi"] },
  { id: "p2", serverIds: ["c"] },
];
const servers = ["a", "b", "c"];
const s: Schedules = {
  "server:a": { every: "day", lastRun: T0, note: null },
  "project:p1": { every: "week", lastRun: T0, note: null },
  "project:p2": { every: "week", lastRun: T0 + 3 * DAY, note: null },
  "server:borrado": { every: "day", lastRun: null, note: null },
};
eq(dueNow(s, projects, servers, T0 + DAY / 2), { keys: [], servers: [] }, "aún no toca nada");
eq(dueNow(s, projects, servers, T0 + DAY), { keys: ["server:a"], servers: ["a"] }, "toca el servidor");
eq(dueNow(s, projects, servers, T0 + 7 * DAY), { keys: ["server:a", "project:p1"], servers: ["a", "b"] }, "servidor y proyecto, sin repetir «a» ni los que no existen");
eq(keyServers("project:p1", projects), ["a", "b", "zombi"], "servidores de un proyecto");
eq(keyServers("server:x", projects), ["x"], "un servidor");

// Puesta al día: con SSHorus cerrado 30 días se hace UNA vez y la próxima cuenta desde ahora.
const late = T0 + 30 * DAY;
const caught = markRun(s, ["server:a"], late, { "server:a": "Sin cambios" });
eq(caught["server:a"], { every: "day", lastRun: late, note: "Sin cambios" }, "una sola vez");
ok(!isDue(caught["server:a"], late + 60_000), "tras ponerse al día no vuelve a tocar enseguida");
ok(caught["project:p1"] === s["project:p1"], "lo demás no cambia");
ok(!("server:zz" in markRun(s, ["server:zz"], late, {})), "no crea claves (se quitó mientras auditaba)");

// ───────── Limpieza y lo guardado ─────────
const pruned = pruneSchedules(s, servers, ["p1", "p2"]);
ok(!("server:borrado" in pruned), "quita servidores borrados");
eq(Object.keys(pruned).length, 3, "deja el resto");
ok(pruneSchedules(pruned, servers, ["p1", "p2"]) === pruned, "sin cambios devuelve lo mismo");
eq(
  parseSchedules({ "server:a": { every: "day", lastRun: 5, note: "x" }, "server:b": { every: "hour" }, "x:y": { every: "day" }, "project:p": { every: "week", lastRun: "ayer" } }),
  { "server:a": { every: "day", lastRun: 5, note: "x" }, "project:p": { every: "week", lastRun: null, note: null } },
  "descarta lo que no vale",
);
eq(parseSchedules([1, 2]), {}, "una lista no vale");
eq(parseSchedules(null), {}, "nada guardado");

// ───────── Bloqueo y servidores ocupados ─────────
const base = { entries: s, projects, serverIds: servers, now: T0 + DAY, busy: () => false };
eq(planTick({ ...base, locked: null }), { kind: "none" }, "sin saber si está bloqueado, espera");
eq(planTick({ ...base, locked: true }), { kind: "skip", keys: ["server:a"], note: LOCKED_NOTE }, "bloqueado: se salta y se dice");
eq(planTick({ ...base, locked: false }), { kind: "run", keys: ["server:a"], servers: ["a"] }, "desbloqueado: se audita");
eq(planTick({ ...base, locked: false, busy: (id) => id === "a" }), { kind: "none" }, "si ya se está auditando, espera");
eq(planTick({ ...base, locked: false, now: T0 }), { kind: "none" }, "nada que hacer");
const skipped = markSkipped(s, ["server:a"], LOCKED_NOTE);
eq(skipped["server:a"], { every: "day", lastRun: T0, note: LOCKED_NOTE }, "saltada: sigue vencida");
ok(markSkipped(skipped, ["server:a"], LOCKED_NOTE) === skipped, "saltarla otra vez no cambia nada (no se guarda cada vuelta)");

// ───────── Nota de cómo fue ─────────
function diff(worsened: boolean, improved = false): AuditDiff {
  const w = worsened ? [{ id: "x", title: "X", from: "ok" as const, to: "bad" as const, weight: 3 }] : [];
  const b = improved ? [{ id: "y", title: "Y", from: "warn" as const, to: "ok" as const, weight: 1 }] : [];
  return { previousAt: "", currentAt: "", scoreBefore: 90, scoreAfter: worsened ? 70 : 90, sudoChanged: false, worse: w, appeared: [], better: b, worsened, improved };
}
const out = (name: string, error: string | null, d: AuditDiff | null): ServerOutcome => ({ profileId: name, name, error, diff: d });
eq(outcomeNote([out("a", null, diff(false))]), "Sin cambios", "sin cambios");
eq(outcomeNote([out("a", null, diff(true))]), "Empeoró: Nota 90 → 70 · 1 empeora", "empeoró");
eq(outcomeNote([out("a", null, diff(false, true))]), "Mejoró: 1 mejora", "mejoró");
eq(outcomeNote([out("a", null, null)]), "Hecha (no había otra para comparar)", "primera vez");
eq(outcomeNote([out("a", "Sin conexión: Falta la contraseña (no está guardada)", null)]), "No se pudo: Sin conexión: Falta la contraseña (no está guardada)", "sin credenciales");
eq(outcomeNote([out("a", null, diff(true)), out("b", null, diff(false)), out("c", "x", null)]), "2 de 3 auditados · empeoró en 1 · 1 no se pudo", "proyecto");
eq(outcomeNote([out("a", "x", null), out("b", "y", null)]), "0 de 2 auditados · 2 no se pudieron", "proyecto sin ninguno");
eq(outcomeNote([]), "No había servidores que auditar", "proyecto vacío");
eq(worsenedChanges([out("a", null, diff(true)), out("b", null, diff(false)), out("c", "x", null)]).map((c) => c.name), ["a"], "solo los que empeoraron");
eq(canceledKeys(["server:a", "server:b", "project:p1"], [out("a", "Cancelado", null), out("b", null, diff(false))], projects), ["server:a", "project:p1"], "cortada: siguen vencidas las que tenían algún servidor sin auditar");
eq(canceledKeys(["server:b"], [out("b", "x", null)], projects), [], "un error no es una cancelación");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
