// Pruebas de los uid de contenedores del Monitor: /etc/subuid, cgroup → contenedor, nombre por conmon,
// memoria del muestreo y cómo se ven las filas de «Por usuario».
import {
  attributionParts,
  containerFromCgroup,
  containersOwnerKey,
  parseCgroupLines,
  parseConmonLines,
  parseSubuid,
  subuidOwner,
} from "./containerUids";
import { ContainerAttribution } from "./attribution";
import { buildSampleCommand, parseSample } from "./sample";
import { summarizeUsers } from "./users";
import { listNames, rowContainerOwner, userRowText } from "./userLabels";
import type { ProcRow } from "./derive";

// Sin @types/node en el proyecto: carga dinámica mínima para ejecutar `sh` en pruebas.
const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8" }) => { status: number | null; stdout: string; stderr: string };
};

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const ID = "3f2a1b9c0d12aabbccddeeff00112233445566778899aabbccddeeff00112233";
const ID2 = "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa";

// ── /etc/subuid ──
const ranges = parseSubuid(["leo_oti:589824:65536", "# comentario", "1001:655360:65536", "mal:formato", "tesis:abc:1", "cero:1:0", ""]);
eq(ranges, [
  { owner: "leo_oti", start: 589824, count: 65536 },
  { owner: "1001", start: 655360, count: 65536 },
], "rangos válidos");
const names = (uid: number) => (uid === 1001 ? "tesis" : null);
eq(subuidOwner(590822, ranges, names), { owner: "leo_oti", innerUid: 999 }, "590822 = uid 999 de leo_oti (postgres)");
eq(subuidOwner(589824, ranges, names), { owner: "leo_oti", innerUid: 1 }, "primero del rango = uid 1");
eq(subuidOwner(589824 + 65536, ranges, names), { owner: "tesis", innerUid: 1 }, "el siguiente rango, dueño por número");
eq(subuidOwner(1000, ranges, names), null, "uid normal: ninguno");
eq(subuidOwner(700000, [{ owner: "2000", start: 700000, count: 10 }], () => null)?.owner, "2000", "dueño por número sin nombre");

// ── cgroup → contenedor ──
const cg = (path: string) => containerFromCgroup(`0::${path}`);
eq(
  cg(`/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-${ID}.scope/container`),
  { engine: "podman", id: "3f2a1b9c0d12" },
  "podman sin root con systemd",
);
eq(cg(`/machine.slice/libpod-${ID}.scope/container`)?.id, "3f2a1b9c0d12", "podman como root");
eq(cg(`/libpod_parent/libpod-${ID}`)?.id, "3f2a1b9c0d12", "podman con cgroupfs");
eq(cg(`/user.slice/user-1000.slice/user@1000.service/user.slice/libpod-conmon-${ID}.scope`), null, "conmon no es el contenedor");
eq(
  cg(`/user.slice/user-1000.slice/user@1000.service/user.slice/user-libpod_pod_${ID2}.slice/libpod-${ID}.scope/container`)?.id,
  "3f2a1b9c0d12",
  "contenedor dentro de un pod",
);
eq(cg(`/system.slice/docker-${ID}.scope`), { engine: "docker", id: "3f2a1b9c0d12" }, "docker con systemd");
eq(containerFromCgroup(`12:memory:/docker/${ID}`)?.engine, "docker", "docker con cgroup v1");
eq(cg(`/kubepods.slice/cri-containerd-${ID}.scope`)?.engine, "other", "containerd");
eq(cg("/user.slice/user-1000.slice/session-3.scope"), null, "sesión normal");
eq(
  [
    ...parseCgroupLines([
      `/proc/10/cgroup:0::/machine.slice/libpod-${ID}.scope/container`,
      `/proc/11/cgroup:12:pids:/docker/${ID2}`,
      `/proc/11/cgroup:11:memory:/docker/${ID2}`,
      "/proc/12/cgroup:0::/system.slice/containerd.service",
      "basura",
    ]),
  ],
  [
    [10, { engine: "podman", id: "3f2a1b9c0d12" }],
    [11, { engine: "docker", id: "998877665544" }],
  ],
  "salida de grep -H (v1 con varias líneas por proceso)",
);

// ── conmon → nombre ──
const conmon = (pid: number, id: string, name: string, sep = " ") =>
  `${pid} ${["/usr/bin/conmon", "--api-version", "1", "-c", id, "-u", id, "-r", "/usr/bin/crun", "-b", `/home/x/${id}/userdata`, "-n", name, "--exit-dir", "/run/user/1000/libpod/tmp/exits"].join(sep)}`;
eq(
  [...parseConmonLines([conmon(300, ID, "seguimiento-siu-db"), conmon(301, ID2, "web", "\u0000"), "302 ", "303 /usr/bin/conmon -c nohex -n x"])],
  [
    [300, { id: "3f2a1b9c0d12", name: "seguimiento-siu-db" }],
    [301, { id: "998877665544", name: "web" }],
  ],
  "id y nombre de la línea de órdenes de conmon (con espacios o NUL)",
);

// ── Script ──
eq(attributionParts([], []), [], "nada que pedir: no se añade nada");
const parts = attributionParts([5, 6, -1], [7]);
eq(parts[0], "echo @@cg; grep -H -e libpod- -e docker -e containerd -e crio /proc/5/cgroup /proc/6/cgroup 2>/dev/null", "cgroup de los pids pedidos");
eq(attributionParts(Array.from({ length: 70 }, (_, i) => i + 2), [])[0].includes("/proc/[0-9]*/cgroup"), true, "muchos: todos");
const cmd = buildSampleCommand({ full: true, uidAll: true, extra: parts });
eq(/[\\'!]/.test(cmd.slice(7, -1)), false, "sin comillas simples, barras ni ! dentro");
eq(cmd.includes("echo @@subuid; cat /etc/subuid"), true, "lee /etc/subuid en las muestras completas");
eq(buildSampleCommand({ full: false }).includes("subuid"), false, "y no en las demás");
eq(cmd.indexOf("@@conmon") < cmd.indexOf("@@df"), true, "antes de df");
// El trozo de conmon de verdad: la línea de órdenes de este mismo `sh`.
const run = spawnSync("sh", ["-c", `${attributionParts([], [99999999])[0]}; ${attributionParts([], [1])[0].replace("for p in 1", () => "for p in $$")}`], {
  encoding: "utf8",
});
eq(run.status, 0, "el trozo de conmon funciona en sh");
eq(/^99999999 ?$/m.test(run.stdout), true, "pid que ya no existe: sin línea de órdenes");
eq(/^\d+ sh -c /m.test(run.stdout), true, "argumentos separados por espacios");

// ── Memoria del muestreo ──
const stat = (pid: number, comm: string, start: number) => `${pid} (${comm}) S 1 0 0 0 0 0 0 0 0 1 1 0 0 20 0 1 0 0 ${start} 1000 50`;
const sample = (lines: string[], procs: [number, string, number][]) =>
  parseSample(["@@begin", "@@ps", "@@psx", ...procs.map(([p, c, s]) => stat(p, c, s)), ...lines, "@@end"].join("\n"));
const at = new ContainerAttribution();
const procs1: [number, string, number][] = [
  [100, "postgres", 10],
  [101, "nginx", 10],
  [300, "conmon", 9],
];
at.absorb(sample(["@@subuid", "leo_oti:589824:65536"], procs1));
at.plan(procs1.map(([pid, comm]) => ({ pid, comm })), true);
const p2 = at.parts();
eq(p2.length, 2, "pide cgroup y conmon de los nuevos");
eq(p2[0].includes("/proc/100/cgroup /proc/101/cgroup /proc/300/cgroup"), true, "cgroup de cada proceso nuevo");
const raw2 = sample(
  ["@@cg", `/proc/100/cgroup:0::/user.slice/libpod-${ID}.scope/container`, "@@conmon", conmon(300, ID, "seguimiento-siu-db")],
  procs1,
);
at.absorb(raw2);
const proc = (pid: number) => raw2.procs.find((p) => p.pid === pid)!;
const userOf = (uid: number) => (uid === 1000 ? "leo_oti" : null);
eq(
  at.containerOf(proc(100), 590822, userOf),
  { owner: "leo_oti", innerUid: 999, engine: "podman", id: "3f2a1b9c0d12", name: "seguimiento-siu-db" },
  "uid subordinado con su contenedor y su nombre",
);
eq(at.containerOf(proc(101), 1000, userOf), null, "fuera de contenedores");
eq(at.containerOf(proc(101), 590000, userOf)?.id, null, "uid subordinado sin cgroup conocido: solo el dueño");
at.plan(procs1.map(([pid, comm]) => ({ pid, comm })), true);
eq(at.parts(), [], "ya leídos: no se vuelve a preguntar");
// El pid 100 se reutiliza (otro arranque): lo de antes ya no vale.
const procs3: [number, string, number][] = [[100, "bash", 50]];
const raw3 = sample([], procs3);
at.absorb(raw3);
eq(at.containerOf(raw3.procs[0], 1000, userOf), null, "pid reutilizado");
at.plan([{ pid: 100, comm: "bash" }], true);
eq(at.parts()[0]?.includes("/proc/100/cgroup"), true, "y se vuelve a preguntar");
const none = new ContainerAttribution();
none.plan([{ pid: 5, comm: "x" }], false);
eq(none.parts(), [], "sin contenedores ni /etc/subuid: nada");

// ── Filas de «Por usuario» ──
const row = (pid: number, uid: number, user: string, rssKb: number, container: ProcRow["container"] = null, comm = "x"): ProcRow => ({
  pid,
  ppid: 1,
  comm,
  state: "S",
  uid,
  user,
  cpuPct: 0,
  memPct: null,
  rssKb,
  elapsed: null,
  container,
});
const sub = (innerUid: number, id: string | null, name: string | null) => ({ owner: "leo_oti", innerUid, engine: "podman" as const, id, name });
const users = summarizeUsers(
  [
    row(1, 0, "root", 3000),
    row(2, 1000, "leo_oti", 200, null, "conmon"),
    row(3, 590822, "590822", 1100, sub(999, "3f2a1b9c0d12", "seguimiento-siu-db")),
    row(4, 590822, "590822", 900, sub(999, "aaaaaaaaaaaa", "otra-db")),
    row(5, 599824, "599824", 100, sub(10001, null, null)),
    row(6, 2000, "tesis", 1500),
  ],
  1,
  10000,
);
eq(
  users.map((u) => u.user),
  ["root", "leo_oti", "590822", "599824", "tesis"],
  "los uid de contenedores van debajo de su dueño; grupos por memoria total",
);
const db = users[2];
eq(db.sub, { owner: "leo_oti", innerUid: 999 }, "dueño y uid de dentro");
eq(db.inContainers.map((c) => c.name), ["otra-db", "seguimiento-siu-db"], "contenedores de la fila");
const ctx = { hidepid: false, elevated: false };
eq(userRowText(db, ctx).main, "Contenedores otra-db y seguimiento-siu-db", "varios contenedores");
eq(userRowText(db, ctx).detail, "de leo_oti · uid 999 dentro", "de quién y qué uid");
eq(userRowText({ ...db, inContainers: db.inContainers.slice(1) }, ctx).main, "Contenedor seguimiento-siu-db", "uno");
eq(userRowText(users[3], ctx).main, "Contenedores de leo_oti", "sin saber aún el contenedor");
eq(userRowText(users[3], ctx).detail, "uid 10001 dentro", "con el uid de dentro");
eq(userRowText(users[0], ctx).main, "root", "usuario normal");
eq(userRowText({ ...users[0], uid: 4242, user: "4242" }, ctx).main, "uid 4242", "uid sin nombre ni rango");
const unknown = { ...users[0], uid: null, user: "…" };
eq(userRowText(unknown, { hidepid: true, elevated: false }).detail, "haría falta sudo", "sin identificar con hidepid");
eq(userRowText(unknown, { hidepid: true, elevated: true }).detail, null, "con sudo, solo falta la próxima muestra");
eq(listNames(["a", "b", "c", "d"]), "a, b y 2 más", "lista larga");
eq(rowContainerOwner(db), { owner: "leo_oti", engine: "podman" }, "a qué dueño lleva «Ver en Contenedores»");
eq(rowContainerOwner(users[0]), null, "sin contenedores: sin botón");

// ── «Ver en Contenedores»: qué dueño elegir allí ──
eq(containersOwnerKey({ owner: "leo_oti", engine: "podman" }, "leo_oti", false), "self", "tus contenedores");
eq(containersOwnerKey({ owner: "leo_oti", engine: "podman" }, "ana", false), "u:leo_oti", "los de otro usuario");
eq(containersOwnerKey({ owner: "root", engine: "podman" }, "ana", false), "root", "los de root");
eq(containersOwnerKey({ owner: "root", engine: "podman" }, "root", true), "self", "eres root");
eq(containersOwnerKey({ owner: "root", engine: "docker" }, "ana", false), "self", "docker: el demonio de siempre");

console.log(`monitor/containerUids: ${passed} pruebas correctas`);
