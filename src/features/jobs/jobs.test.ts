// Pruebas de las tareas en segundo plano: lista (añadir, historial con tope, terminar, quitar, filtro),
// texto de estado, aviso sin salida, salida en vivo, ejecución con «Cancelar» y el script que detiene
// todo el grupo de procesos (se ejecuta de verdad con `sh` en una carpeta temporal).
import { clearJobHistory, getJob, openJobCenter, removeJob, setJobsPopover, useJobs } from "../../stores/jobs";
import { JobOutput, cleanLine } from "./output";
import { jobScript, killJobScript } from "./remoteScript";
import { runKillable } from "./remote";
import { cancelJob, JobCanceled, onJobFinished, startJob, trackJob, type JobCtx } from "./run";
import {
  addJob,
  clearFinished,
  dismissJob,
  finishedJob,
  formatClock,
  jobCounts,
  jobStall,
  lastMeaningfulLine,
  matchesFilter,
  MAX_FINISHED,
  newJob,
  patchJob,
  stallText,
  statusLine,
  stepsAt,
  type Job,
} from "../../stores/jobsState";

const CHILD = "node:child_process";
const cp = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; env?: Record<string, string | undefined> }) => { status: number | null; stdout: string; stderr: string };
  spawn: (cmd: string, args: string[], opts: { env?: Record<string, string | undefined> }) => {
    on: (ev: "exit", cb: (code: number | null, sig: string | null) => void) => void;
    stdout: { on: (ev: "data", cb: (d: { toString(): string }) => void) => void };
  };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  readFileSync: (p: string, enc: "utf8") => string;
  existsSync: (p: string) => boolean;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── Lista: añadir, historial con tope, cambiar, terminar, quitar ──
const T0 = 1_000_000;
const mk = (id: string, extra: Partial<Job> = {}): Job => ({ ...newJob(id, { kind: "k", sessionId: "s1", server: "vps", title: id, steps: ["Uno", "Dos"] }, T0), ...extra });

const fresh = mk("a");
eq([fresh.status, fresh.cancelLabel, fresh.steps.map((s) => s.state), fresh.watchOutput], ["running", "Cancelar", ["current", "todo"], true], "tarea nueva: en marcha, primer paso en curso");
eq(newJob("b", { kind: "k", sessionId: null, server: "", title: "x", cancelLabel: null }, T0).cancelLabel, null, "sin botón de cancelar");

let list: Job[] = [];
for (let i = 0; i < MAX_FINISHED + 5; i++) list = addJob(list, mk(`f${i}`, { status: "done", endedAt: T0 + i }));
eq(list.length, MAX_FINISHED, "historial con tope");
eq(list[0].id, `f${MAX_FINISHED + 4}`, "la más nueva arriba");
ok(!list.some((j) => j.id === "f0"), "se descartan las terminadas más viejas");
list = addJob(list, mk("r1"));
list = addJob(list, mk("r2"));
eq(list.filter((j) => j.status === "running").length, 2, "las que están en marcha no cuentan para el tope");
eq(list.length, MAX_FINISHED + 2, "en marcha + historial");
eq(list.slice(0, 2).map((j) => j.id), ["r2", "r1"], "las nuevas arriba");

const same = patchJob(list, "nadie", { title: "x" });
ok(same === list, "cambiar una que no existe no crea otra lista");
list = patchJob(list, "r1", { phase: "Leyendo…" });
eq(list.find((j) => j.id === "r1")?.phase, "Leyendo…", "cambiar una tarea");

const r1 = list.find((j) => j.id === "r1") as Job;
const doneOk = finishedJob({ ...r1, steps: stepsAt(["Uno", "Dos"], 1) }, { status: "done", summary: "Listo" }, T0 + 5000);
eq([doneOk.status, doneOk.endedAt, doneOk.summary, doneOk.phase, doneOk.steps.map((s) => s.state)], ["done", T0 + 5000, "Listo", null, ["done", "done"]], "terminada bien: paso en curso hecho");
const doneBad = finishedJob(r1, { status: "failed" }, T0 + 1);
eq([doneBad.error, doneBad.steps.map((s) => s.state)], ["Falló", ["error", "todo"]], "falló: mensaje por defecto y el paso en curso con error");
const canceled = finishedJob({ ...r1, stopping: true }, { status: "canceled" }, T0 + 1);
eq([canceled.status, canceled.stopping, canceled.error], ["canceled", false, null], "cancelada");

eq(dismissJob(list, "r1").length, list.length, "no se quita una en marcha");
eq(dismissJob(list, "f10").length, list.length - 1, "se quita una terminada");
eq(clearFinished(list).map((j) => j.id), ["r2", "r1"], "vaciar el historial deja las que están en marcha");
eq(jobCounts([mk("x"), mk("y", { status: "failed" }), mk("z", { status: "done" })]), { running: 1, failed: 1, finished: 2 }, "cuentas");

const ct = mk("c", { kind: "compose", key: "p1" });
ok(matchesFilter(ct, null) && matchesFilter(ct, { label: "", kind: "compose", sessionId: "s1" }) && !matchesFilter(ct, { label: "", key: "p2" }), "filtro por tipo, conexión y proyecto");

// ── Texto de estado y aviso sin salida ──
eq(lastMeaningfulLine(["Instalando…", "=====", "   "]), "Instalando…", "última línea que dice algo");
eq(statusLine(mk("s")), "Empezando…", "sin nada todavía");
eq(statusLine(mk("s", { phase: "Leyendo paquetes…" })), "Leyendo paquetes…", "la fase");
eq(statusLine(mk("s", { phase: "Actualizando", phaseAt: T0, lines: ["Upgrading : openssl 3/10"], lastOutputAt: T0 + 10 })), "Upgrading : openssl 3/10", "la salida si es más nueva");
eq(statusLine(mk("s", { phase: "Consultando OSV.dev…", phaseAt: T0 + 20, lines: ["Complete!"], lastOutputAt: T0 + 10 })), "Consultando OSV.dev…", "la fase si es más nueva");
eq(statusLine(mk("s", { stopping: true })), "Deteniendo…", "deteniendo");
eq(statusLine(mk("s", { status: "failed", error: "No hay red\nmás detalle" })), "No hay red", "falló: primera línea del error");
eq(statusLine(mk("s", { status: "done", summary: "3 arreglados" })), "3 arreglados", "terminada: el resultado");
eq(stallText(30), null, "con salida reciente, sin aviso");
eq(stallText(65), "Sin salida nueva desde hace 1 min — puede seguir trabajando (descargando, instalando) o estar atascada", "aviso al minuto");
ok(jobStall(mk("s"), T0 + 125_000)?.includes("2 min") === true, "aviso de una tarea callada");
eq(jobStall(mk("s", { watchOutput: false }), T0 + 125_000), null, "sin aviso si no escribe salida (reinicio)");
eq(jobStall(mk("s", { stopping: true }), T0 + 125_000), null, "sin aviso mientras se detiene");
eq(jobStall(mk("s", { status: "done" }), T0 + 125_000), null, "sin aviso al terminar");
eq([formatClock(0), formatClock(42_900), formatClock(65_000), formatClock(725_000), formatClock(3_729_000)], ["0:00", "0:42", "1:05", "12:05", "1:02:09"], "reloj");

// ── Salida en vivo ──
eq(cleanLine("\x1b[32mhola\x1b[0m"), "hola", "sin colores");
eq(cleanLine("10%\r50%\r100%"), "100%", "solo el último dibujo con \\r");
const plain = new JobOutput();
plain.push("uno\ndos");
eq(plain.view(), ["uno", "dos"], "la línea a medias también se ve");
plain.push(" y medio\r\n\n");
eq(plain.view(), ["uno", "dos y medio"], "se junta con lo que llega después; las vacías no cuentan");
const rules = new JobOutput({ progressKey: (l) => (/^capa (\w+)/.exec(l)?.[1] ?? null), mapLine: (l) => (l.startsWith("#") ? null : l) });
rules.push("capa a 10%\ncapa b 5%\n# ruido\ncapa a 100%\nfin\n");
eq(rules.view(), ["capa a 100%", "capa b 5%", "fin"], "las de progreso se juntan y el ruido se quita");
const big = new JobOutput();
for (let i = 0; i < 2500; i++) big.push(`línea ${i}\n`);
ok(big.view().length <= 2200 && big.view()[big.view().length - 1] === "línea 2499" && big.dropped > 0, "se guardan solo las últimas");

// ── Ejecutar: fases, salida, resultado y aviso ──
const finished: string[] = [];
const off = onJobFinished((j) => finished.push(`${j.id}:${j.status}`));
const id1 = startJob({
  kind: "prueba",
  sessionId: null,
  title: "Tarea",
  steps: ["Paso 1", "Paso 2"],
  run: async (ctx) => {
    ctx.output("hola\nmundo\n");
    ctx.step(1);
    ctx.phase("Comprobando…", { done: 1, total: 2 });
    await tick();
    return { summary: "Todo bien", data: { n: 1 } };
  },
});
eq(getJob(id1)?.status, "running", "empieza en marcha");
await tick(5);
const j1 = getJob(id1) as Job;
eq([j1.status, j1.summary, j1.lines, j1.steps.map((s) => s.state), j1.data], ["done", "Todo bien", ["hola", "mundo"], ["done", "done"], { n: 1 }], "termina con su resultado, su salida y los pasos hechos");
eq(useJobs.getState().notices, [id1], "aviso en la esquina al terminar");
ok(finished.includes(`${id1}:done`), "avisa a quien escucha");

const id2 = startJob({ kind: "prueba", sessionId: null, title: "Falla", run: async () => Promise.reject(new Error("Sin conexión")) });
await tick(5);
eq([getJob(id2)?.status, getJob(id2)?.error], ["failed", "Sin conexión"], "si lanza, falla con su mensaje");

// Cancelar: se ejecuta lo que la tarea pidió y queda cancelada aunque la tarea no lance.
let stopped = false;
setJobsPopover(true);
const id3 = startJob({
  kind: "prueba",
  sessionId: null,
  title: "Larga",
  run: (ctx) =>
    new Promise((resolve) => {
      ctx.onCancel(() => {
        stopped = true;
        resolve({ summary: "a medias" });
      });
    }),
});
await tick();
const stopping = cancelJob(id3);
eq(getJob(id3)?.stopping, true, "deteniendo hasta que termina");
await stopping;
await tick(5);
eq([stopped, getJob(id3)?.status, getJob(id3)?.summary], [true, "canceled", "a medias"], "cancelada, con lo que devolvió");
ok(!useJobs.getState().notices.includes(id3), "sin aviso si ya se está mirando la ventanita");
setJobsPopover(false);

// La vista grande en una tarea quita su aviso; quitar una tarea la saca de todo.
openJobCenter({ jobId: id1 });
eq([useJobs.getState().center, useJobs.getState().selected, useJobs.getState().notices.includes(id1)], [true, id1, false], "abrir la tarea en grande");
removeJob(id1);
eq([getJob(id1), useJobs.getState().selected], [undefined, null], "quitada de la lista");

// Tarea llevada por fuera (reinicio): terminar, volver a ponerla en marcha y cancelar.
let stopWaiting = 0;
const t = trackJob({ kind: "reboot", sessionId: null, title: "Reiniciar", watchOutput: false, cancelLabel: "Dejar de esperar" }, () => {
  stopWaiting++;
});
t.update({ phase: "Esperando…" });
t.finish({ status: "failed", error: "No volvió" });
eq([getJob(t.id)?.status, getJob(t.id)?.error], ["failed", "No volvió"], "seguida: falló");
t.resume({ phase: "Comprobando…" });
eq([getJob(t.id)?.status, getJob(t.id)?.error, getJob(t.id)?.endedAt], ["running", null, null], "seguida: otra vez en marcha");
await cancelJob(t.id);
t.finish({ status: "done" });
eq([stopWaiting, getJob(t.id)?.status], [1, "canceled"], "seguida: cancelar llama a quien la lleva y queda cancelada");
clearJobHistory();
eq(useJobs.getState().jobs.length, 0, "vaciar el historial");
off();

// runKillable: «Cancelar» ejecuta el script que mata el grupo, envuelto igual que la tarea.
const ran: { script: string; run: boolean }[] = [];
let release: (v: string) => void = () => undefined;
const id4 = startJob({
  kind: "prueba",
  sessionId: null,
  title: "Remota",
  run: async (ctx: JobCtx) => {
    await runKillable(ctx, "sleep 100", 600, {
      wrap: (s) => `COMO_DUEÑO\n${s}`,
      exec: (script, run) => {
        ran.push({ script, run: !!run });
        return run ? new Promise<string>((r) => (release = r)) : Promise.resolve("stopped");
      },
    });
  },
});
await tick();
await cancelJob(id4);
release("");
await tick(5);
eq(ran.map((r) => r.run), [true, false], "la tarea y luego su parada");
ok(ran[0].script.startsWith("COMO_DUEÑO\n") && ran[0].script.includes("setsid") && ran[0].script.includes("sleep 100"), "la tarea va envuelta para su dueño y en su grupo");
ok(ran[1].script.startsWith("COMO_DUEÑO\n") && ran[1].script.includes("kill -TERM"), "la parada también va como su dueño");
eq(getJob(id4)?.status, "canceled", "remota cancelada");
ok(new JobCanceled().message === "Cancelado", "error de cancelada");

// Al cancelar, el canal termina «bien» (el grupo murió, código 143): no debe seguir con lo de después.
let after = false;
let release5: (v: { code: number }) => void = () => undefined;
const id5 = startJob({
  kind: "prueba",
  sessionId: null,
  title: "Carrera al cancelar",
  run: async (ctx: JobCtx) => {
    await runKillable(ctx, "dnf upgrade -y", 600, {
      exec: (_s, run) => (run ? new Promise<{ code: number }>((r) => (release5 = r)) : Promise.resolve({ code: 0 })),
      stdout: () => "partial",
    });
    after = true;
  },
});
await tick();
await cancelJob(id5);
release5({ code: 143 });
await tick(5);
eq([after, getJob(id5)?.status], [false, "canceled"], "cancelada: no sigue con lo de después aunque el canal acabe bien");
ok(getJob(id5)?.lines.some((l) => l.includes("no se pudo detener todo")) ?? false, "si el servidor no pudo parar todo, se avisa");

// Si se pasa de tiempo, también se mata el grupo en el servidor.
const ran6: boolean[] = [];
const id6 = startJob({
  kind: "prueba",
  sessionId: null,
  title: "Tiempo",
  run: async (ctx: JobCtx) => {
    await runKillable(ctx, "sleep 100", 1, {
      exec: (_s, run) => (ran6.push(!!run), Promise.resolve({ timedOut: !!run })),
      timedOut: (r) => r.timedOut,
    });
  },
});
await tick(5);
eq([ran6, getJob(id6)?.status], [[true, false], "done"], "pasado de tiempo: se para el grupo");

// ── Script de la tarea y «Cancelar» de verdad con sh ──
const tmp = fs.mkdtempSync("/tmp/sshorus-jobs-");
const sh = (script: string) => cp.spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...env, TMPDIR: tmp } });
try {
  const id = "test-job-1234";
  const job = cp.spawn("sh", ["-c", jobScript(id, "echo empieza; sleep 30 & sleep 30; echo nunca")], { env: { ...env, TMPDIR: tmp } });
  let jobOut = "";
  job.stdout.on("data", (d) => (jobOut += d.toString()));
  const exited = new Promise<number | null>((res) => job.on("exit", (code) => res(code)));
  await tick(600);
  ok(fs.existsSync(`${tmp}/sshorus-job-${id}.pid`), "la tarea apunta su grupo");
  const group = fs.readFileSync(`${tmp}/sshorus-job-${id}.pid`, "utf8").trim();
  const started = Date.now();
  eq(sh(killJobScript(id)).stdout.trim(), "stopped", "cancelar: detenida");
  const code = await exited;
  ok(Date.now() - started < 8000, "cancelar no espera a que acabe sola");
  ok(code !== 0 && jobOut.includes("empieza") && !jobOut.includes("nunca"), "cancelar: no llega al final");
  eq(sh(`kill -0 -${group} 2>/dev/null && echo vivo || echo nada`).stdout.trim(), "nada", "no queda nada del grupo (tampoco el «sleep» en segundo plano)");
  eq(sh(killJobScript(id)).stdout.trim(), "gone", "cancelar otra vez: ya no está");
  ok(!fs.existsSync(`${tmp}/sshorus-job-${id}.pid.cancel`), "y no deja el aviso de cancelar");

  // Cancelar antes de que la tarea apunte su grupo (sudo aún pidiendo paso): la tarea ya no empieza.
  const early = "test-job-early";
  const killer = cp.spawn("sh", ["-c", killJobScript(early)], { env: { ...env, TMPDIR: tmp } });
  let killOut = "";
  killer.stdout.on("data", (d) => (killOut += d.toString()));
  const killed = new Promise<number | null>((res) => killer.on("exit", (c) => res(c)));
  await tick(300);
  const late = sh(jobScript(early, "echo corre"));
  await killed;
  eq([late.status, late.stdout.trim(), killOut.trim()], [130, "", "gone"], "cancelada antes de empezar: no corre nada");
  ok(!fs.existsSync(`${tmp}/sshorus-job-${early}.pid.cancel`), "ni queda el aviso");
  const fine = sh(jobScript("test-job-5678", "echo hola; exit 3"));
  eq([fine.status, fine.stdout.trim()], [3, "hola"], "una tarea normal devuelve su salida y su código");
  ok(!fs.existsSync(`${tmp}/sshorus-job-test-job-5678.pid`), "al terminar se borra el archivo del grupo");

  // Sin setsid (el shell de la tarea no es jefe de grupo): se para su árbol de procesos.
  const lone = "test-job-9012";
  const pf = `${tmp}/sshorus-job-${lone}.pid`;
  const noGroup = cp.spawn("sh", ["-c", `echo $$ >"${pf}"; exec sh -c 'sleep 31 & sleep 32; echo nunca'`], { env: { ...env, TMPDIR: tmp } });
  const gone = new Promise<number | null>((res) => noGroup.on("exit", (c) => res(c)));
  await tick(600);
  const shell = fs.readFileSync(pf, "utf8").trim();
  eq(sh(killJobScript(lone)).stdout.trim(), "stopped", "sin grupo propio: detenida");
  await gone;
  eq(sh(`pgrep -P ${shell} >/dev/null 2>&1 && echo vivo; pgrep -f 'sleep 3[12]$' >/dev/null && echo vivo || echo nada`).stdout.trim(), "nada", "sin grupo propio: no quedan hijos");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`jobs: ${passed} comprobaciones OK`);
