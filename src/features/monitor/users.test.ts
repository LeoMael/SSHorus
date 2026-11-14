// Pruebas del resumen por usuario del Monitor (y de lo que la muestra aporta para él).
// Ejecutar: npx rolldown src/features/monitor/users.test.ts -p node -f esm -o /tmp/mu.mjs && node /tmp/mu.mjs
import { filterByUser, procScope, summarizeUsers } from "./users";
import { buildSampleCommand, parseSample } from "./sample";
import type { ProcRow } from "./derive";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const row = (pid: number, uid: number | null, user: string | null, cpuPct: number | null, rssKb: number, comm = "x"): ProcRow => ({
  pid,
  ppid: 1,
  comm,
  state: "S",
  uid,
  user,
  cpuPct,
  memPct: null,
  rssKb,
  elapsed: null,
});

// ── Resumen por usuario ──
const rows = [
  row(10, 0, "root", 50, 1000),
  row(11, 0, "root", 30, 500, "containerd-shim"),
  row(20, 1000, "ana", 100, 4000),
  row(21, 1000, "ana", null, 1000, "conmon"),
  row(22, 1000, "ana", 20, 0, "conmon"),
  row(30, null, null, null, 200),
];
const sum = summarizeUsers(rows, 4, 10000);
eq(
  sum.map((u) => `${u.user} ${u.procs} ${u.cpuPct} ${u.rssKb} ${u.containers}`),
  ["ana 3 30 5000 2", "root 2 20 1500 1", "… 1 null 200 0"],
  "suma por usuario, CPU del servidor (4 núcleos), contenedores y orden por memoria",
);
eq(sum[0].memPct, 50, "memoria en % del total");
eq(summarizeUsers([row(1, 0, "root", 900, 0)], 2, null)[0].cpuPct, 100, "nunca más del 100 %");
eq(summarizeUsers([row(1, 0, "root", 50, 0)], null, null)[0].memPct, null, "sin total de memoria");
eq(filterByUser(rows, 1000).map((r) => r.pid), [20, 21, 22], "filtro por usuario");
eq(filterByUser(rows, null).length, 6, "sin filtro: todos");

// ── Qué se ve ──
eq(procScope(false, 1000, false, sum), "all", "sin hidepid se ve todo");
eq(procScope(true, 0, false, sum), "all", "root ve todo");
eq(procScope(true, 1000, true, sum), "all-sudo", "con sudo");
eq(procScope(true, 1000, false, [sum[0]]), "own", "hidepid: solo los tuyos");
eq(procScope(true, 1000, false, sum), "all", "hidepid con grupo que deja ver a otros");

// ── Muestra: hidepid, dueños y procesos del propio muestreo ──
const full = buildSampleCommand({ full: true, uidAll: true });
eq(full.includes('stat -c "%u %n" /proc/[0-9]*'), true, "dueño de todos");
eq(/[\\'!]/.test(full.slice(7, -1)), false, "sin comillas simples, barras ni ! dentro");
eq(buildSampleCommand({ full: false, uidPids: [5, 6] }).includes("/proc/5 /proc/6"), true, "solo los pids pedidos");
eq(
  buildSampleCommand({ full: false, uidPids: Array.from({ length: 70 }, (_, i) => i + 2) }).includes("/proc/[0-9]*"),
  true,
  "muchos pids: todos",
);
const stat = (pid: number, comm: string, ppid: number) => `${pid} (${comm}) S ${ppid} 0 0 0 0 0 0 0 0 1 1 0 0 20 0 1 0 100 1000 50`;
const raw = parseSample(
  [
    "@@begin",
    "@@self=40",
    "@@info",
    "uid=1000",
    "hidepid=invisible",
    "@@ps",
    "@@psx",
    stat(1, "init", 0),
    stat(30, "sh", 1),
    stat(35, "sudo", 30),
    stat(36, "cat", 30),
    stat(40, "sh", 35),
    stat(41, "cut", 40),
    stat(50, "nginx", 1),
    "@@end",
  ].join("\n"),
);
eq(raw.info?.hidepid, true, "hidepid=invisible");
eq(raw.procs.map((p) => p.pid), [1, 50], "sin el sh, sudo, cat y cut del propio muestreo");
eq(parseSample("@@info\nhidepid=\n@@end").info?.hidepid, false, "sin hidepid");
eq(parseSample("@@info\nhidepid=0\n@@end").info?.hidepid, false, "hidepid=0");

console.log(`monitor/users: ${passed} pruebas correctas`);
