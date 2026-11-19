// Pruebas de «¿Puede usar contenedores?»: lectura, rango libre de subuid/subgid y comandos para dar o quitar.
// Ejecutar: npx rolldown src/features/admin/containerAccess.test.ts -p node -f esm -o /tmp/ca.mjs && node /tmp/ca.mjs
import {
  CONTAINER_ACCESS_SCRIPT,
  freeSubidRange,
  parseContainerAccess,
  parseSubids,
  rangeText,
  userContainers,
  type ContainerAccessInfo,
} from "./containerAccess";
import { containerActions, grantDockerPlan, grantPodmanPlan, lingerPlan, podmanMigrateStep, revokeDockerPlan, revokePodmanPlan } from "./containerPlans";
import { detectEnv } from "./commands";

// Sin @types/node en el proyecto: se carga a mano lo justo para ejecutar `sh`.
const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; env?: Record<string, string | undefined> }) => { status: number | null; stdout: string; stderr: string };
};
const FS = "node:fs";
const fs = (await import(/* @vite-ignore */ FS)) as {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, s: string, o?: { mode: number }) => void;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
};
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// ── Lectura (Rocky 10 con podman; leo con rangos y linger, tesis sin rangos, ana en docker) ──
const OUT = [
  "@@uid",
  "0",
  "@@tools",
  "podman",
  "docker-group",
  "subid-usermod",
  "systemd",
  "@@subuid",
  "leo:100000:65536",
  "1003:231072:65536",
  "# comentario",
  "roto:abc:1",
  "@@subgid",
  "leo:100000:65536",
  "1003:231072:65536",
  "@@linger",
  "leo",
  "@@dockersock",
  "1004",
  "@@end",
].join("\n");
const info = parseContainerAccess(OUT);
eq(info.podman, true, "podman");
eq(info.docker, true, "docker (el grupo existe)");
eq(info.subuid.length, 2, "líneas no válidas fuera");
eq([...(info.linger ?? [])], ["leo"], "linger");
eq([...(info.dockerSockets ?? [])], [1004], "docker sin root");

const u = (name: string, uid: number, groups: string[] = [], isSystem = false) => ({ name, uid, groups, isSystem });
const leo = userContainers(info, u("leo", 1000, ["leo", "wheel"]));
eq([leo.podman, leo.linger, leo.dockerGroup, leo.dockerRootless], ["yes", true, false, false], "leo");
const oti = userContainers(info, u("leo_oti", 1003));
eq(oti.podman, "yes", "rango por UID");
eq(oti.linger, false, "sin linger");
const tesis = userContainers(info, u("tesis", 1002));
eq(tesis.podman, "limited", "sin rangos: limitado");
const ana = userContainers(info, u("ana", 1004, ["ana", "docker"]));
eq([ana.dockerGroup, ana.dockerRootless], [true, true], "ana: grupo docker y docker sin root");
eq(userContainers(info, u("root", 0, ["root", "docker"])).podman, null, "root: nada que mostrar");
eq(userContainers(info, u("root", 0, ["root", "docker"])).dockerGroup, false, "root no cuenta como «grupo docker»");
eq(userContainers(info, u("sshd", 74, [], true)).podman, null, "cuenta del sistema sin rangos: nada");

// Sin root: no se ven los sockets de otros; sin podman ni systemd: nada de eso.
const plain = parseContainerAccess("@@uid\n1000\n@@tools\n@@subuid\n@@subgid\n@@linger\n@@dockersock\n1000\n@@end\n");
eq(plain.dockerSockets, null, "sin root no se sabe");
eq(plain.linger, null, "sin systemd");
eq(userContainers(plain, u("tesis", 1002)).podman, null, "sin podman no se muestra");
let threw = false;
try {
  parseContainerAccess("@@uid\n0\n");
} catch {
  threw = true;
}
ok(threw, "salida cortada: error");

// ── Rango libre ──
const r = (start: number, count: number, owner = "x") => ({ owner, start, count });
eq(freeSubidRange([], []), { start: 100000, count: 65536 }, "vacío: desde 100000");
eq(freeSubidRange(info.subuid, info.subgid), { start: 165536, count: 65536 }, "hueco entre leo y 1003");
eq(freeSubidRange([r(100000, 65536), r(165536, 65536)], []), { start: 231072, count: 65536 }, "tras los ocupados");
eq(freeSubidRange([r(100000, 65536)], [r(165536, 100)]), { start: 165636, count: 65536 }, "subgid también cuenta");
eq(freeSubidRange([r(300000, 65536), r(100000, 65536)], []), { start: 165536, count: 65536 }, "desordenado: primer hueco que cabe");
eq(freeSubidRange([r(150000, 10)], []), { start: 150010, count: 65536 }, "un rango pequeño en medio");
eq(freeSubidRange([r(0, 200000)], []), { start: 200000, count: 65536 }, "uno que empieza antes del mínimo");
eq(freeSubidRange([r(100000, 600000000)], []), null, "lleno");
eq(freeSubidRange([r(1, 1)], [], 65536, 100000, 165535), { start: 100000, count: 65536 }, "justo hasta el máximo");
eq(rangeText({ start: 100000, count: 65536 }), "100000-165535", "rango primero-último");
eq(parseSubids(["a:1:0", " b:5:10 "]), [{ owner: "b", start: 5, count: 10 }], "count 0 fuera");

// ── Comandos ──
const home = { name: "tesis", home: "/home/tesis" };
const g = grantPodmanPlan(home, tesis, { start: 165536, count: 65536 }, true);
eq(g.steps[1], "usermod --add-subuids 165536-231071 --add-subgids 165536-231071 'tesis'", "usermod");
ok(g.steps.some((s) => s.includes("podman system migrate")), "migrate");
eq(g.steps[g.steps.length - 1], "loginctl enable-linger 'tesis'", "linger");
ok(!g.danger, "no es peligroso");
const half = grantPodmanPlan(home, { subuid: [r(1, 2)], subgid: [], linger: true }, { start: 165536, count: 65536 }, true);
eq(half.steps[1], "usermod --add-subgids 165536-231071 'tesis'", "solo lo que falta");
ok(!half.steps.some((s) => s.includes("linger")), "ya tiene linger");
const rv = revokePodmanPlan({ name: "leo", home: "/home/leo" }, leo, true);
eq(rv.steps[0], "usermod --del-subuids 100000-165535 --del-subgids 100000-165535 'leo'", "quitar rangos");
eq(rv.steps[rv.steps.length - 1], "loginctl disable-linger 'leo'", "apagar linger");
eq(revokePodmanPlan({ name: "leo", home: "/home/leo" }, leo, false).steps.length, 2, "sin tocar linger");
eq(lingerPlan("leo_oti", true).steps, ["loginctl enable-linger 'leo_oti'"], "linger solo");
const envSh = detectEnv(new Set(["useradd", "usermod", "gpasswd"]), "rocky", ["rhel"]);
const gd = grantDockerPlan(envSh, "tesis");
ok(gd.danger && gd.steps.includes("gpasswd -a 'tesis' 'docker'"), "docker: peligroso");
eq(revokeDockerPlan(envSh, "ana").steps, ["gpasswd -d 'ana' 'docker'"], "quitar docker");

// ── Qué se ofrece ──
eq(containerActions({ info, user: tesis, uid: 1002 }), ["podman-grant", "docker-grant"], "tesis");
eq(containerActions({ info, user: oti, uid: 1003 }), ["podman-revoke", "linger-on", "docker-grant"], "leo_oti");
eq(containerActions({ info, user: ana, uid: 1004 }), ["podman-grant", "docker-revoke"], "ana");
const noUsermod: ContainerAccessInfo = { ...info, subidUsermod: false };
eq(containerActions({ info: noUsermod, user: tesis, uid: 1002 }), ["docker-grant"], "usermod viejo: sin podman");

// ── En un shell de verdad ──
const tmp = fs.mkdtempSync("/tmp/sshorus-ca-");
try {
  const bin = `${tmp}/bin`;
  fs.mkdirSync(bin, { recursive: true });
  // runuser falso: quita «-u usuario --» y ejecuta el resto; podman falso: dice qué le pidieron.
  fs.writeFileSync(`${bin}/runuser`, '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(`${bin}/podman`, '#!/bin/sh\necho "podman $*"\n', { mode: 0o755 });
  const path = `${bin}:${env.PATH ?? "/usr/bin:/bin"}`;
  const run = (script: string) => spawnSync("sh", ["-ec", script], { encoding: "utf8", env: { ...env, PATH: path } });
  const userHome = `${tmp}/home/a b`;
  const step = podmanMigrateStep({ name: "tesis", home: `${userHome}/` });
  eq(run(step).stdout, "", "sin carpeta de podman: no hace nada");
  fs.mkdirSync(`${userHome}/.local/share/containers`, { recursive: true });
  eq(run(step).stdout.trim(), "podman system migrate", "con carpeta: migrate como el usuario");
  fs.writeFileSync(`${bin}/podman`, "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  const failed = run(`${step}\necho sigue`);
  eq([failed.status, failed.stdout.trim()], [0, "sigue"], "si migrate falla, no corta el plan");
  ok(failed.stderr.includes("Aviso"), "avisa");

  const real = spawnSync("sh", ["-c", CONTAINER_ACCESS_SCRIPT], { encoding: "utf8" });
  ok(parseContainerAccess(real.stdout), "el script de lectura corre y termina en @@end");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`containerAccess: ${passed} comprobaciones OK`);
