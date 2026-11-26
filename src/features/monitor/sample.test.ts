// Pruebas del análisis de una muestra del servidor (/proc, procesos y procesos del propio muestreo).
import { buildSampleCommand, parseCpu, parseMeminfo, parseProcCutLine, parseProcStatLine, parseSample } from "./sample";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// ── CPU y memoria ──
eq(parseCpu(["cpu  10 2 3 80 5 0 0 1 0 0"]), { total: 101, idle: 85, iowait: 5, steal: 1 }, "línea cpu");
eq(parseCpu(["cpu0 1 2 3 4"]), null, "solo la línea total");
const mem = parseMeminfo(["MemTotal: 1000 kB", "MemFree: 100 kB", "Buffers: 50 kB", "Cached: 200 kB", "SReclaimable: 20 kB"]);
eq(mem?.availableKb, 370, "sin MemAvailable: libre + búferes + caché");
eq(mem?.cachedKb, 220, "caché con SReclaimable");
eq(parseMeminfo(["MemFree: 1 kB"]), null, "sin total");

// ── Procesos ──
eq(parseProcStatLine("42 (tmux: server) S 1 0 0 0 0 0 0 0 0 0 7 3 0 0 0 0 0 0 999 0 12"), {
  pid: 42,
  ppid: 1,
  comm: "tmux: server",
  state: "S",
  ticks: 10,
  start: 999,
  rssPages: 12,
}, "nombre con espacios");
eq(parseProcCutLine("7 (sshd) S 1 4 6 500 30")?.ticks, 10, "línea de cut");
eq(parseProcCutLine("7 (tmux: S 1 4 6 500 30"), null, "nombre con espacios: viene en @@psx");

// ── Muestra completa: se quitan el shell del muestreo y sus hijos ──
const out = [
  "@@begin",
  "@@self=100",
  "@@stat",
  "cpu  10 0 10 80 0 0 0 0",
  "@@ps",
  "1 (systemd) S 0 5 5 1 100",
  "99 (sudo) S 1 0 0 50 10",
  "100 (sh) S 99 0 0 51 10",
  "101 (cut) R 100 0 0 52 10",
  "200 (nginx) S 1 3 3 60 40",
  "@@end",
].join("\n");
const s = parseSample(out, 5);
eq(s.procs.map((p) => p.pid), [1, 200], "fuera sudo, sh y sus hijos");
eq([s.selfPid, s.complete, s.noProc, s.at], [100, true, false, 5], "marcas");
eq(parseSample("@@begin\n@@noproc\n").noProc, true, "sin /proc");
eq(parseSample("@@begin\n").complete, false, "salida cortada");

// ── Comando ──
const cmd = buildSampleCommand({ full: false, uidPids: [5, -1, 6] });
eq(cmd.startsWith("sh -c '") && !cmd.slice(7, -1).includes("'"), true, "sin comillas simples dentro");
eq(cmd.includes("/proc/5 /proc/6"), true, "dueño de los pids pedidos (sin los no válidos)");
eq(cmd.includes("@@info"), false, "muestra corta: sin @@info");

console.log(`sample: ${passed} pruebas OK`);
