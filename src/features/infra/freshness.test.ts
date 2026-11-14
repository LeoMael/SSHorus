// Pruebas de la caché del mapa: cuándo releer, «Actualizado hace…» y qué mapas se olvidan.
// Ejecutar: npx rolldown src/features/infra/freshness.test.ts -p node -f esm -o /tmp/freshness.mjs && node /tmp/freshness.mjs
import { MAX_AGE_MS, needsReload, staleKeys, updatedAgo } from "./freshness";

let fails = 0;
let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  n++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    fails++;
    console.error(`FALLO: ${msg}\n  obtenido: ${sa}\n  esperado: ${sb}`);
  }
}

const now = 1_000_000_000;
const e = { at: now - 60_000, token: "s1#0" };

// ───────── Releer ─────────
eq(needsReload(undefined, "s1#0", now), true, "nunca leído → leer");
eq(needsReload(e, "s1#0", now), false, "leído hace un minuto con la misma conexión → mostrar lo guardado");
eq(needsReload(e, "s1#1", now), true, "reconectado → releer");
eq(needsReload({ ...e, at: now - MAX_AGE_MS - 1 }, "s1#0", now), true, "más de 10 min → releer");
eq(needsReload({ ...e, at: now - MAX_AGE_MS }, "s1#0", now), false, "justo 10 min todavía vale");

// ───────── Antigüedad ─────────
eq(updatedAgo(now - 5_000, now), "hace un momento", "segundos");
eq(updatedAgo(now + 5_000, now), "hace un momento", "reloj adelantado: no negativo");
eq(updatedAgo(now - 3 * 60_000, now), "hace 3 min", "minutos");
eq(updatedAgo(now - 65 * 60_000, now), "hace 1 h 5 min", "horas");

// ───────── Olvidar los más antiguos ─────────
const entries = { a: { at: 1, token: "" }, b: { at: 3, token: "" }, c: { at: 2, token: "" }, d: { at: 0, token: "" } };
eq(staleKeys(entries, "d", 3).sort(), ["a"], "se queda la actual y las 2 más recientes");
eq(staleKeys(entries, "b", 10), [], "por debajo del máximo no se olvida nada");
eq(staleKeys(entries, "b", 1).sort(), ["a", "c", "d"], "con máximo 1 solo queda la actual");

console.log(fails ? `${fails} de ${n} pruebas FALLARON` : `OK: ${n} pruebas`);
if (fails) throw new Error("pruebas fallidas");
