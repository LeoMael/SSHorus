// Pruebas de la auditoría de los contenedores sin root de cada usuario: leer la salida de Podman (real, de
// Podman 6 en Fedora) y las comprobaciones con sus arreglos como el dueño.
import type { StoreUser } from "../../api/vulnscan";
import { runChecks } from "./checks";
import { dangerousMounts, floatingTag, openPorts, runsAsRoot, userContainerChecks } from "./checksUserContainers";
import { ROCKY_SERVER } from "./fixtures";
import { fixLevel } from "./fixSafety";
import { parseUserContainers, type UserContainersRead } from "./userContainers";

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

const NOW = Date.parse("2026-11-26T12:00:00Z");
const ID = "e0d5992d1a67599eab9ff5762571b90f14154addadbba9838e2073897de7e1f0";

// Salida real de USER_CONTAINERS_SCRIPT (Podman 6.1): uno con -p 18080:80 y /etc montado; otro con --memory 256m,
// --user 1000 y el puerto solo en local. Más un contenedor infra de un pod y uno viejo con el socket.
const ALICE = [
  `C|sshorus-audtest|false||0|docker.io/library/debian:stable-slim|${ID}|0.0.0.0:18080->80/tcp `,
  "M|/host-etc|/etc",
  "",
  `C|sshorus-audtest2|false|1000|268435456|docker.io/library/debian:stable-slim|${ID}|127.0.0.1:18081->81/tcp `,
  "",
  "C|a1b2c3-infra|false||0|localhost/podman-pause:6.1.3-1700000000|abc|",
  "",
  `I|${ID}|1795392000`,
].join("\n");
const BOB = [
  "C|panel|true|root|0|ghcr.io/acme/panel|ffff|:9000->9000/tcp ",
  "M|/var/run/docker.sock|/run/user/1002/podman/podman.sock",
  "M|/data|/home/bob/data|with|bar",
  "I|ffff|1600000000",
].join("\n");

const alice = parseUserContainers("alice", ALICE);
eq(alice.length, 2, "el contenedor infra del pod no cuenta");
eq(alice[0].ports, ["0.0.0.0:18080->80/tcp"], "puertos");
eq(alice[0].mounts, [{ dest: "/host-etc", source: "/etc" }], "montajes");
eq(alice[0].imageCreated, 1795392000 * 1000, "fecha de la imagen");
eq(alice[1].memory, 268435456, "límite de memoria");
eq(alice[1].user, "1000", "usuario dentro");
const bob = parseUserContainers("bob", BOB);
eq(bob[0].mounts[1].source, "/home/bob/data|with|bar", "el origen puede llevar «|»");
ok(bob[0].privileged, "privilegiado");

// ── Reglas sueltas ──
eq(dangerousMounts(alice[0]), ["/etc → /host-etc"], "/etc es peligroso");
eq(dangerousMounts(bob[0]), ["/run/user/1002/podman/podman.sock → /var/run/docker.sock"], "el socket de podman es peligroso");
eq(openPorts(alice[1]), [], "en 127.0.0.1 no está expuesto");
eq(openPorts(bob[0]), [":9000->9000/tcp"], "sin IP = todas las interfaces");
ok(floatingTag("ghcr.io/acme/panel"), "sin etiqueta = latest");
ok(floatingTag("nginx:latest"), "latest");
ok(!floatingTag("docker.io/library/debian:stable-slim"), "etiqueta fija");
ok(!floatingTag("localhost:5000/app:1.2"), "el puerto del registro no es una etiqueta");
ok(floatingTag("localhost:5000/app"), "registro con puerto y sin etiqueta");
ok(!floatingTag("nginx@sha256:abcd"), "por digest");
ok(runsAsRoot("") && runsAsRoot("0:0") && !runsAsRoot("1000"), "root dentro");

// ── Comprobaciones ──
const user = (name: string, uid: number, linger: boolean | null): StoreUser => ({ name, uid, home: `/home/${name}`, podman: true, docker: false, runtimeDir: uid !== 1002, linger });
const read: UserContainersRead = {
  users: [user("alice", 1001, true), user("bob", 1002, false)],
  containers: [...alice, ...bob],
  errors: ["carol: permiso denegado"],
  runuser: true,
};
const checks = userContainerChecks(read, NOW);
const by = (id: string) => checks.find((c) => c.id === id);
eq(by("ctr.users")?.status, "info", "resumen");
ok(by("ctr.users")?.items.includes("No se pudo leer carol: permiso denegado"), "los que no se leyeron, en el resumen");
eq(by("ctr.users.privileged")?.status, "bad", "--privileged");
eq(by("ctr.users.mounts")?.items.length, 2, "dos montajes peligrosos");
eq(by("ctr.users.ports")?.items, ["alice/sshorus-audtest: 0.0.0.0:18080->80/tcp", "bob/panel: :9000->9000/tcp"], "puertos expuestos");
eq(by("ctr.users.latest")?.items, ["bob/panel: ghcr.io/acme/panel"], "sin versión fija");
eq(by("ctr.users.old")?.items.length, 1, "una imagen vieja");
eq(by("ctr.users.root")?.items, ["alice/sshorus-audtest", "bob/panel"], "root dentro");
const mem = by("ctr.users.memory");
eq(mem?.items, ["alice/sshorus-audtest", "bob/panel"], "sin límite de memoria");
eq(fixLevel(mem!), "confirm", "poner límite de memoria pide confirmación");
eq(
  mem?.fix?.command.split("\n")[0],
  "runuser -u alice -- env HOME=/home/alice XDG_RUNTIME_DIR=/run/user/1001 podman update --memory 1g sshorus-audtest",
  "el arreglo entra como el dueño",
);
ok(mem?.fix?.command.split("\n")[1].includes("sshorus-run-1002"), "sin /run/user, con su carpeta propia");
const linger = by("ctr.users.linger");
eq(linger?.items, ["bob"], "bob no tiene linger");
eq(linger?.fix?.command, "loginctl enable-linger bob", "arreglo de linger");
eq(fixLevel(linger!), "auto", "linger es un arreglo seguro");
ok(checks.every((c) => !/alice|bob|carol/.test(c.detail)), "el detalle no lleva usuarios (va a la IA)");
ok(by("ctr.users.privileged")?.fix?.manual, "--privileged solo se explica");

// Sin su: su
const su = userContainerChecks({ ...read, runuser: false }, NOW).find((c) => c.id === "ctr.users.memory");
ok(su?.fix?.command.startsWith("su -s /bin/sh alice -c "), "sin runuser, con su");

// Nombre raro: no se escribe arreglo para él.
const weird = userContainerChecks({ ...read, containers: [{ ...alice[0], name: "x;rm -rf /" }] }, NOW).find((c) => c.id === "ctr.users.memory");
eq(weird?.fix, null, "sin arreglo para nombres raros");

// Vacío, sin sudo y sin systemd.
eq(userContainerChecks({ users: [], containers: [], errors: [], runuser: false }, NOW).map((c) => c.status), ["info"], "nadie tiene contenedores");
eq(userContainerChecks(null, NOW)[0].status, "skip", "sin sudo, sin comprobar");
ok(!userContainerChecks({ ...read, users: [user("alice", 1001, null), user("bob", 1002, null)] }, NOW).some((c) => c.id === "ctr.users.linger"), "sin systemd no se mira linger");

// Dentro de la auditoría: solo si se leyeron (sin el campo, como antes).
const base = { stdout: ROCKY_SERVER, elevated: true, ports: null, web: null, vuln: null, now: NOW };
ok(!runChecks(base).checks.some((c) => c.id.startsWith("ctr.users")), "sin leer, no aparecen");
ok(runChecks({ ...base, userCtrs: read }).checks.some((c) => c.id === "ctr.users.mounts"), "leídos, aparecen");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
