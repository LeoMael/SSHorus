// Pruebas de la historia del muestreo (puntos de las gráficas y CPU sostenida).
import { appendHistory, nextCpuHistory, type CpuMark } from "./history";
import { HISTORY_MS } from "./prefs";
import type { HistoryPoint } from "./derive";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const pt = (t: number): HistoryPoint => ({ t, cpu: 1, mem: null, rx: null, tx: null, load: null });

// ── Puntos de las gráficas ──
const now = 10 * HISTORY_MS;
const old = [pt(now - HISTORY_MS - 1), pt(now - HISTORY_MS), pt(now - 1000)];
eq(appendHistory(old, pt(now), now).map((p) => p.t), [now - HISTORY_MS, now - 1000, now], "quita lo de hace más de 5 min");
eq(old.length, 3, "no cambia la lista original");
eq(appendHistory([], pt(now), now).length, 1, "primer punto");

// ── CPU sostenida ──
const mark = (uptime: number, total: number, idle: number): CpuMark => ({ uptime, cpu: { total, idle, iowait: 0, steal: 0 } });

let r = nextCpuHistory([], null);
eq(r, { sustained: null, hist: [] }, "sin contadores: nada");

r = nextCpuHistory([], mark(100, 1000, 500));
eq(r.sustained, null, "una sola marca: aún no hay media");
eq(r.hist.length, 1, "se guarda la marca");

r = nextCpuHistory([mark(100, 1000, 500)], mark(170, 2000, 750));
eq(r.sustained, 75, "media del último minuto: 1 − 250/1000");
eq(r.hist.map((h) => h.uptime), [100, 170], "se acumulan");

r = nextCpuHistory([mark(10, 0, 0), mark(500, 1000, 500)], mark(700, 2000, 1000));
eq(r.hist.map((h) => h.uptime), [500, 700], "más de 10 min: fuera");

r = nextCpuHistory([mark(5000, 1000, 500)], mark(30, 100, 50));
eq(r.hist.map((h) => h.uptime), [30], "reinicio del servidor: se empieza de cero");
eq(r.sustained, null, "tras reiniciar no hay media");

console.log(`history: ${passed} pruebas OK`);
