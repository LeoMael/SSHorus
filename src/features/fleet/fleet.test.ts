// Pruebas del Panel de VPS: agrupar, comando y análisis de la lectura, avisos y motor simulado.
// Ejecutar: npx rolldown src/features/fleet/fleet.test.ts -p node -f esm -o /tmp/fleet.mjs && node /tmp/fleet.mjs
import type { ExecResult, Project, ServerProfile } from "../../api/types";
import { compareHost, fleetTargets, groupVps, pickProfile, sections, uniqueVps } from "./group";
import { formatUptime, pushHistory, retryDelayMs, warnings, emptyLive, MAX_RETRY_MS } from "./health";
import { FleetPoller, type PollerDeps } from "./poller";
import { buildProbeCommand, fullestDisk, parseProbe } from "./probe";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: ${a} ≠ ${b}`);
  passed++;
}

const srv = (id: string, name: string, host: string, username = "leo", port = 22, extra: Partial<ServerProfile> = {}): ServerProfile => ({
  id,
  name,
  host,
  port,
  username,
  auth: "key",
  keyPath: null,
  defaultPath: null,
  color: null,
  ...extra,
});
const proj = (id: string, name: string, serverIds: string[]): Project => ({ id, name, serverIds, bookmarks: [], color: null });

// ───────── Agrupar ─────────
{
  const servers = [
    srv("a", "TESIS", "2.25.131.217", "tesis"),
    srv("b", "Leo", "2.25.131.217 ", "leo", 22, { sudoMode: "login" }),
    srv("c", "web prod", "10.0.0.10", "root"),
    srv("d", "web prod", "10.0.0.10", "deploy"),
    srv("e", "otro", "10.0.0.9"),
    srv("f", "mismo host, otro puerto", "10.0.0.9", "leo", 2222),
  ];
  const projects = [proj("p1", "Tesis", ["a"]), proj("p2", "Web", ["c", "e"])];
  const vps = groupVps(servers, projects);
  eq(vps.length, 4, "un VPS por host+puerto");
  const tesis = vps.find((v) => v.key === "2.25.131.217:22")!;
  eq(tesis.name, "2.25.131.217", "sin nombre común: el host");
  eq(tesis.profiles.map((p) => p.id), ["a", "b"], "usuarios del VPS");
  eq(tesis.projectIds, ["p1"], "proyectos del VPS");
  eq(vps.find((v) => v.key === "10.0.0.10:22")!.name, "web prod", "nombre común");
  eq(groupVps([srv("x", "web prod", "h"), srv("y", "web dev", "h")], [])[0].name, "web", "palabras comunes");
  eq(groupVps([srv("x", "ab 1", "h"), srv("y", "ab 2", "h")], [])[0].name, "h", "prefijo demasiado corto");

  const byProject = sections(vps, projects, "project");
  eq(byProject.map((s) => [s.title, s.vps.map((v) => v.key)]), [
    ["Tesis", ["2.25.131.217:22"]],
    ["Web", ["10.0.0.9:22", "10.0.0.10:22"]],
    ["Sin proyecto", ["10.0.0.9:2222"]],
  ], "secciones por proyecto");
  eq(sections(vps, projects, "ip")[0].vps.map((v) => v.key), ["2.25.131.217:22", "10.0.0.9:22", "10.0.0.9:2222", "10.0.0.10:22"], "orden por IP");
  eq(sections(vps, projects, "project", "p1").map((s) => s.title), ["Tesis"], "solo un proyecto");
  eq(sections(vps, projects, "ip", "p2")[0].vps.length, 2, "por IP dentro de un proyecto");
  eq(uniqueVps(byProject).length, 4, "VPS sin repetir");
  const keys = (l: { key: string }[]) => l.map((v) => v.key).sort();
  eq(keys(fleetTargets(vps, ["p1"])), ["2.25.131.217:22"], "pestaña de un proyecto: sus VPS");
  eq(keys(fleetTargets(vps, ["p1", "p2"])), ["10.0.0.10:22", "10.0.0.9:22", "2.25.131.217:22"], "dos proyectos: la unión");
  eq(fleetTargets(vps, ["p2", null]).length, 4, "con «Todos los VPS»: todos");
  eq(fleetTargets(vps, []).length, 0, "sin pestañas: ninguno");
  eq(fleetTargets(vps, ["borrado"]).length, 0, "proyecto que ya no existe: ninguno");
  eq(compareHost("b.example", "10.0.0.1") > 0, true, "IPs antes que nombres");

  const none = { withTab: new Set<string>(), sudoUsers: new Set<string>() };
  eq(pickProfile(tesis, none)?.id, "b", "con sudo configurado");
  eq(pickProfile(tesis, { ...none, sudoUsers: new Set(["tesis"]) })?.id, "a", "con sudo visto");
  eq(pickProfile(tesis, { ...none, withTab: new Set(["a"]) })?.id, "a", "con pestaña abierta");
  eq(pickProfile(vps.find((v) => v.key === "10.0.0.10:22")!, none)?.id, "c", "root");
  eq(pickProfile(vps.find((v) => v.key === "10.0.0.9:22")!, none)?.id, "e", "el primero");
}

// ───────── Comando y análisis ─────────
const SAMPLE = [
  "@@begin",
  "@@stat",
  "cpu  100 0 100 800 0 0 0 0 0 0",
  "@@stat2",
  "cpu  150 0 150 900 0 0 0 0 0 0",
  "@@mem",
  "MemTotal:        1000000 kB",
  "MemFree:          50000 kB",
  "MemAvailable:     50000 kB",
  "@@load",
  "0.50 0.40 0.30 1/200 999",
  "@@up",
  "200000.5 1000.0",
  "@@nproc",
  "2",
  "@@host",
  "vps1",
  "@@os",
  'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
  "@@reboot=1",
  "@@updates",
  "",
  "12 updates can be applied immediately.",
  "@@failed",
  "nginx.service loaded failed failed A high performance web server",
  "● cron.service loaded failed failed Regular background program processing daemon",
  "@@ct=docker",
  "web|running|Up 2 hours",
  "db|exited|Exited (1) 3 minutes ago",
  "job|exited|Exited (0) 1 day ago",
  "loop|restarting|Restarting (1) 5 seconds ago",
  "@@ct=podman",
  "web|running|Up 2 hours",
  "@@users",
  "leo:1000:leo sudo docker",
  "tesis:1001:tesis",
  "root:0:root",
  "fantasma::",
  "@@df",
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "/dev/sda1        100000     95000      5000      95% /",
  "/dev/sdb1        100000     10000     90000      10% /data",
  "@@end",
].join("\n");
{
  const cmd = buildProbeCommand({ users: ["leo", "evil'; rm -rf /", "a b", "x$(id)"], warmup: false });
  const inner = cmd.slice("sh -c '".length, -1);
  eq(/['\\!]/.test(inner), false, "sin comillas simples, barras ni ! dentro");
  eq(cmd.includes("for u in leo;"), true, "solo usuarios con nombre seguro");
  eq(cmd.includes("@@stat2"), false, "sin doble lectura de CPU");
  eq(buildProbeCommand({ users: [], warmup: true }).includes("sleep 1; echo @@stat2"), true, "doble lectura en la primera ronda");

  const p = parseProbe(SAMPLE);
  eq(p.complete, true, "completa");
  eq(Math.round(p.cpuPct ?? -1), 50, "CPU de la doble lectura");
  eq(Math.round(p.mem?.usedPct ?? -1), 95, "memoria");
  eq([p.load, p.nproc, p.uptimeSecs, p.hostname, p.os], [[0.5, 0.4, 0.3], 2, 200000.5, "vps1", "Ubuntu 24.04.1 LTS"], "datos básicos");
  eq([p.rebootRequired, p.updates], [true, 12], "reinicio y actualizaciones");
  eq(p.failedUnits, ["nginx.service", "cron.service"], "servicios caídos");
  eq(p.containers, { engines: ["docker", "podman"], running: 1, stopped: 3, failed: ["db", "loop"], error: null }, "contenedores (sin repetir)");
  eq(p.users.map((u) => [u.name, u.exists, u.sudo]), [["leo", true, true], ["tesis", true, false], ["root", true, true], ["fantasma", false, false]], "usuarios y sudo");
  eq(fullestDisk(p.disks)?.mount, "/", "disco más lleno");

  const bare = parseProbe("@@begin\n@@stat\ncpu 1 0 1 8\n@@up\n@@ct=docker\npermission denied while trying to connect\n@@end\n");
  eq([bare.cpuPct, bare.uptimeSecs, bare.rebootRequired, bare.failedUnits], [null, null, null, null], "lo que no se sabe queda en null");
  eq(bare.containers?.error, "permission denied while trying to connect", "error de docker");
}

// ───────── Avisos y reglas ─────────
{
  const p = parseProbe(SAMPLE);
  eq(warnings({ status: "online", probe: p }).map((w) => w.text), [
    "Disco al 95 % (/)",
    "Memoria al 95 %",
    "2 servicios caídos",
    "2 contenedores caídos",
    "Reinicio pendiente",
  ], "avisos");
  eq(warnings({ status: "offline", probe: p }), [{ level: "bad", text: "Sin conexión" }], "sin conexión");
  eq(warnings({ status: "attention", probe: null }), [], "esperando al usuario");
  eq([1, 2, 3, 10].map((n) => retryDelayMs(n, 15_000)), [15_000, 30_000, 60_000, MAX_RETRY_MS], "espera creciente");
  const h = pushHistory([{ at: 0, cpu: 1, mem: 1 }, { at: 500_000, cpu: 2, mem: 2 }], { at: 700_000, cpu: 3, mem: 3 });
  eq(h.map((x) => x.at), [500_000, 700_000], "historial de 10 min");
  eq([formatUptime(200000), formatUptime(3700), formatUptime(90), formatUptime(null)], ["2 d 7 h", "1 h 1 min", "1 min", "—"], "tiempo encendido");
}

// ───────── Motor simulado ─────────
const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", exitCode: 0, durationMs: 1, truncated: false, timedOut: false });
const apiErr = (kind: string) => Object.assign(new Error(kind), { kind });

function fakeDeps(over: Partial<PollerDeps> = {}) {
  const log: string[] = [];
  let t = 1_000_000;
  const deps: PollerDeps = {
    tabSession: () => null,
    tabReconnecting: () => false,
    connect: async (id) => {
      log.push(`connect ${id}`);
      return `s-${id}`;
    },
    connectInteractive: async (id) => {
      log.push(`dialog ${id}`);
      return `i-${id}`;
    },
    exec: async (sid) => {
      log.push(`exec ${sid}`);
      return ok(SAMPLE);
    },
    disconnect: async (sid) => {
      log.push(`close ${sid}`);
    },
    now: () => t,
    ...over,
  };
  return { deps, log, advance: (ms: number) => (t += ms) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

async function engineTests() {
  const vps = groupVps(
    [srv("a", "A", "1.1.1.1"), srv("b", "B", "2.2.2.2"), srv("c", "C", "3.3.3.3"), srv("d", "D", "4.4.4.4"), srv("e", "E", "5.5.5.5")],
    [],
  );

  // Concurrencia limitada, lectura y cierre de lo propio.
  {
    const { deps, log } = fakeDeps();
    let live: Record<string, ReturnType<typeof emptyLive>> = {};
    const pl = new FleetPoller(deps, (l) => (live = l), 15_000);
    pl.setTargets(vps);
    pl.pump();
    eq(log.filter((l) => l.startsWith("connect")).length, 4, "como mucho 4 a la vez");
    await flush();
    await flush();
    eq(Object.values(live).filter((l) => l.status === "online").length, 5, "todos leídos");
    eq(live["1.1.1.1:22"].owned, true, "conexión propia");
    eq(Math.round(live["1.1.1.1:22"].cpuPct ?? -1), 50, "CPU");
    pl.pump();
    eq(log.filter((l) => l.startsWith("exec")).length, 5, "no relee antes de tiempo");
    pl.dispose();
    eq(log.filter((l) => l.startsWith("close")).length, 5, "al cerrar, cierra sus conexiones");
  }

  // Pide contraseña: no pregunta solo y no reintenta en bucle.
  {
    const { deps, log, advance } = fakeDeps({
      connect: async (id) => {
        log.push(`connect ${id}`);
        throw apiErr("NeedsPassword");
      },
    });
    let live: Record<string, ReturnType<typeof emptyLive>> = {};
    const pl = new FleetPoller(deps, (l) => (live = l), 15_000);
    pl.setTargets(vps.slice(0, 1));
    pl.pump();
    await flush();
    eq([live["1.1.1.1:22"].status, live["1.1.1.1:22"].attention], ["attention", "password"], "espera a «Conectar»");
    advance(60_000);
    pl.pump();
    await flush();
    eq(log.filter((l) => l.startsWith("connect")).length, 1, "no vuelve a intentar solo");
    eq(log.some((l) => l.startsWith("dialog")), false, "ningún diálogo sin pedirlo");
    await pl.connectNow("1.1.1.1:22");
    await flush();
    await flush();
    eq([live["1.1.1.1:22"].status, live["1.1.1.1:22"].sessionId], ["online", "i-a"], "«Conectar» con diálogo");
    eq(pl.handOver("1.1.1.1:22"), { profileId: "a", sessionId: "i-a" }, "entrega la sesión a una pestaña");
    pl.dispose();
    eq(log.some((l) => l === "close i-a"), false, "la sesión entregada no se cierra");
  }

  // Sin red: espera creciente.
  {
    const { deps, log, advance } = fakeDeps({
      connect: async (id) => {
        log.push(`connect ${id}`);
        throw apiErr("Network");
      },
    });
    let live: Record<string, ReturnType<typeof emptyLive>> = {};
    const pl = new FleetPoller(deps, (l) => (live = l), 15_000);
    pl.setTargets(vps.slice(0, 1));
    pl.pump();
    await flush();
    eq([live["1.1.1.1:22"].status, live["1.1.1.1:22"].failures], ["offline", 1], "sin conexión");
    advance(15_000);
    pl.pump();
    await flush();
    eq(live["1.1.1.1:22"].failures, 2, "segundo intento");
    advance(15_000);
    pl.pump();
    await flush();
    eq(log.length, 2, "aún no toca el tercero (espera 30 s)");
    pl.dispose();
  }

  // Con pestaña abierta: reutiliza su sesión y no abre otra.
  {
    const { deps, log } = fakeDeps({ tabSession: (ids) => (ids.includes("a") ? { profileId: "a", sessionId: "tab-a" } : null) });
    let live: Record<string, ReturnType<typeof emptyLive>> = {};
    const pl = new FleetPoller(deps, (l) => (live = l), 15_000);
    pl.setTargets(vps.slice(0, 1));
    pl.pump();
    await flush();
    eq(log, ["exec tab-a"], "usa la sesión de la pestaña");
    eq(live["1.1.1.1:22"].owned, false, "no es suya");
    pl.dispose();
    eq(log.length, 1, "no cierra la pestaña");
  }
}

await engineTests();
console.log(`fleet: ${passed} comprobaciones correctas`);
