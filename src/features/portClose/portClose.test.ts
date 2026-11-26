// Pruebas de «Cerrar puerto»: quién abre el puerto, qué opciones se ofrecen en cada caso (SSH, Docker y
// Podman con y sin root, servicio del sistema y de usuario, programa suelto, sin permiso; firewalld, ufw,
// nftables, apagado o ya bloqueado), los comandos y la sintaxis de los scripts que se envían.
import type { ListenPort } from "../admin/ports";
import type { FoundContainer } from "../containers/readAll";
import { blockPort, outsideZones } from "../infra/firewall/block";
import { trialScript } from "../infra/firewall/commands";
import { DEBIAN, ROCKY, UBUNTU, UBUNTU_OFF } from "../infra/firewall/fixtures";
import { parseFirewallReport } from "../infra/firewall/report";
import type { FwReport } from "../infra/firewall/types";
import { containerStopStep, killStep, localPublish, unitStep } from "./commands";
import { findOpener, portOfMapNode } from "./opener";
import { closeOptions, type CloseInput } from "./options";
import type { CloseOption, CloseStep } from "./types";

const nodeModule = (name: string) => import(/* @vite-ignore */ name);
const { spawnSync } = await nodeModule("node:child_process");

let n = 0;
function eq(got: unknown, want: unknown, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  n++;
}
const ok = (c: boolean, what: string) => eq(c, true, what);
/** El script es sh válido (sin ejecutarlo). */
const shOk = (script: string, what: string) => eq(spawnSync("sh", ["-n", "-c", script]).status, 0, `${what}: sintaxis de sh`);

function lp(port: number, o: Partial<ListenPort> = {}): ListenPort {
  return { key: `tcp|0.0.0.0||${port}`, proto: "tcp", ip: "0.0.0.0", iface: null, port, family: 4, scope: "public", procs: [], user: null, unit: null, container: null, ...o };
}

function ctr(name: string, o: Partial<FoundContainer> = {}): FoundContainer {
  return {
    id: `${name}000000000000000000`,
    shortId: `${name}0000000`.slice(0, 12),
    name,
    image: "nginx:latest",
    state: "running",
    status: "Up",
    exitCode: null,
    health: null,
    created: null,
    ports: [{ hostIp: "0.0.0.0", hostPort: 8080, containerPort: 80, protocol: "tcp", range: 1 }],
    labels: {},
    networks: [],
    command: "",
    composeProject: null,
    composeService: null,
    composeWorkingDir: null,
    composeConfigFiles: null,
    pod: null,
    engine: "docker",
    user: "root",
    ctOwner: { kind: "self" },
    sudo: true,
    ...o,
  };
}

const rocky = parseFirewallReport(ROCKY);
const ubuntu = parseFirewallReport(UBUNTU);
const debian = parseFirewallReport(DEBIAN);
const ubuntuOff = parseFirewallReport(UBUNTU_OFF);
const SSH = [22];

function plan(port: ListenPort, containers: FoundContainer[], firewall: FwReport | null, me = "ana", extra: Partial<CloseInput> = {}) {
  return closeOptions({ port, opener: findOpener(port, containers, SSH), firewall, sshPorts: SSH, me, ...extra });
}
const ids = (opts: CloseOption[]) => opts.map((o) => `${o.id}${o.action ? "" : "×"}${o.recommended ? "*" : ""}`);
const steps = (o: CloseOption | undefined): CloseStep[] => (o?.action?.kind === "run" ? o.action.steps : []);
const get = (opts: CloseOption[], id: string) => opts.find((o) => o.id === id);

// ───────── SSH: nunca se cierra ─────────
{
  eq(findOpener(lp(22), [], SSH).kind, "ssh", "el puerto de esta conexión es SSH");
  eq(findOpener(lp(2222, { procs: [{ name: "sshd", pid: 900 }] }), [], SSH).kind, "ssh", "otro puerto de sshd");
  eq(findOpener(lp(2200, { unit: "ssh.socket" }), [], SSH).kind, "ssh", "ssh.socket");
  const p = plan(lp(22, { procs: [{ name: "sshd", pid: 900 }], unit: "sshd.service" }), [], ubuntu);
  eq(p.options.length, 0, "SSH: ninguna opción");
  ok(p.explain.includes("te quedas fuera"), "SSH: se explica por qué no");
  eq(blockPort(ubuntu, 22, "tcp", SSH).kind, "error", "bloquear SSH en el cortafuegos: nunca");
}

// ───────── Docker con root: el cortafuegos no basta ─────────
{
  const web = ctr("web", { composeProject: "tienda", ctOwner: { kind: "root" } });
  const port = lp(8080, { procs: [{ name: "docker-proxy", pid: 1500 }], user: "root" });
  const o = findOpener(port, [web], SSH);
  eq(o.kind === "container" && [o.name, o.engine, o.rootless], ["web", "docker", false], "docker-proxy → contenedor de Docker con root");
  const p = plan(port, [web], ubuntu);
  eq(ids(p.options), ["ctr-local*", "ctr-stop", "firewall×"], "Docker: primero publicar en local; el cortafuegos, no");
  ok(get(p.options, "firewall")!.blocked!.includes("Docker"), "Docker: se dice por qué el cortafuegos no basta");
  ok(p.explain.includes("se salta el cortafuegos"), "Docker: la explicación lo dice");
  const local = get(p.options, "ctr-local")!.action;
  ok(local?.kind === "compose" && local.owner === "root" && local.hint.includes('"8080:80" por "127.0.0.1:8080:80"'), "Docker + Compose: qué cambiar en el compose");
  eq(steps(get(p.options, "ctr-stop")).map((s) => s.show), ["docker stop web (con sudo)"], "Docker: parar el contenedor");
  // Sin la lista de contenedores (sin sudo): se sabe que es Docker por docker-proxy, pero no cuál.
  const blind = plan(port, [], ubuntu);
  eq(ids(blind.options), ["ctr-local×", "ctr-stop×", "firewall×"], "Docker sin ver el contenedor: nada automático");
  const solo = plan(port, [ctr("web", { ctOwner: { kind: "root" } })], ubuntu);
  ok(get(solo.options, "ctr-local")!.action?.kind === "hint", "contenedor sin Compose: solo se explica cómo");
  eq(ids(solo.options), ["ctr-local", "ctr-stop*", "firewall×"], "sin Compose se recomienda parar");
}

// ───────── Podman sin root: el cortafuegos sí sirve ─────────
{
  const ana = { name: "ana", uid: 1000, home: "/home/ana", podman: true, docker: false, runtimeDir: true };
  const app = ctr("app", { engine: "podman", user: "luis", ctOwner: { kind: "user", user: { ...ana, name: "luis", uid: 1001 } }, sudo: true });
  const port = lp(8080, { procs: [{ name: "rootlessport", pid: 2100 }], user: "luis" });
  const o = findOpener(port, [app], SSH);
  eq(o.kind === "container" && [o.engine, o.rootless], ["podman", true], "rootlessport → Podman sin root");
  const p = plan(port, [app], rocky);
  eq(ids(p.options), ["firewall*", "ctr-local", "ctr-stop"], "Podman sin root: el cortafuegos primero");
  ok(p.explain.includes("sí respeta el cortafuegos"), "Podman sin root: la explicación lo dice");
  const fw = get(p.options, "firewall")!.action;
  ok(fw?.kind === "firewall" && fw.plan.apply[0] === `firewall-cmd --zone=public --add-rich-rule='rule port port="8080" protocol="tcp" reject'`, "firewalld: regla enriquecida en la zona pública");
  eq(steps(get(p.options, "ctr-stop")).map((s) => s.show), ["podman stop app (como luis)"], "contenedor de otro usuario: como su dueño");
  // Arrancado por un servicio (Quadlet): se para el servicio de ese usuario.
  const q = ctr("app", { engine: "podman", user: "luis", labels: { PODMAN_SYSTEMD_UNIT: "app.service" }, ctOwner: app.ctOwner });
  const st = containerStopStep(q, "ana");
  ok(st?.kind === "shell" && st.root && st.show === "runuser -u luis -- systemctl --user stop app.service", "Quadlet: se para su servicio");
  // Podman con root: como Docker.
  const rootPod = ctr("db", { engine: "podman", user: "root", ctOwner: { kind: "root" } });
  eq(ids(plan(lp(8080, { procs: [{ name: "conmon", pid: 1 }], user: "root" }), [rootPod], rocky).options), ["ctr-local", "ctr-stop*", "firewall×"], "Podman con root: el cortafuegos no basta");
}

// ───────── Servicio de systemd ─────────
{
  const port = lp(8005, { procs: [{ name: "nginx", pid: 700 }], user: "root", unit: "nginx.service" });
  const p = plan(port, [], ubuntu);
  eq(ids(p.options), ["firewall*", "stop", "disable"], "servicio: cortafuegos, parar o desactivar");
  eq(steps(get(p.options, "disable")).map((s) => [s.show, s.kind === "shell" && s.root]), [["systemctl disable --now nginx.service", true]], "desactivar con sudo");
  const fw = get(p.options, "firewall")!.action;
  ok(fw?.kind === "firewall" && fw.plan.apply[1] === "ufw prepend deny 8005/tcp" && fw.plan.trial && fw.plan.checkLogin, "ufw: deny al principio, a prueba");
  ok(fw?.kind === "firewall" && fw.plan.revert[0].includes("/etc/ufw/") && fw.plan.revert[0].includes("ufw reload"), "ufw: deshacer deja las reglas como estaban");
  if (fw?.kind === "firewall") shOk(trialScript(fw.plan, "t1"), "ufw a prueba");
  ok(p.explain.includes("«nginx»"), "servicio: se nombra");
  // Servicio de usuario: el tuyo sin sudo; el de otro, como él.
  const mine = unitStep("api.service", "stop", { userUnit: true, user: "ana", me: "ana" });
  eq(mine?.kind === "shell" && [mine.show, mine.root], ["systemctl --user stop api.service", false], "servicio de usuario propio, sin sudo");
  const other = unitStep("api.service", "disable", { userUnit: true, user: "luis", me: "ana" });
  ok(other?.kind === "shell" && other.root && other.script.includes("runuser -u luis") && other.script.includes("su -s /bin/sh luis"), "servicio de otro usuario, como él");
  if (other?.kind === "shell") shOk(other.script, "servicio de otro usuario");
  eq(unitStep("x;rm -rf /.service", "stop", { userUnit: false, user: null, me: null }), null, "nombre de servicio raro: nada");
}

// ───────── Programa suelto y sin permiso ─────────
{
  const p = plan(lp(3000, { procs: [{ name: "node", pid: 4321 }], user: "ana" }), [], ubuntu);
  eq(ids(p.options), ["firewall*", "kill"], "programa: cortafuegos o terminarlo");
  eq(steps(get(p.options, "kill")).map((s) => [s.show, s.kind === "shell" && s.root]), [["kill 4321", false]], "tu programa: sin sudo");
  eq(killStep([1, 812, 812], "root", "ana"), { kind: "shell", show: "kill 812", script: "kill 812", root: true }, "nunca el PID 1; de otro, con sudo");
  const u = plan(lp(8080), [], rocky);
  eq(ids(u.options), ["firewall*"], "sin ver el programa: solo el cortafuegos");
  ok(u.explain.includes("sin sudo"), "sin permiso: se explica");
}

// ───────── Cortafuegos: cada caso ─────────
{
  const port = lp(8081, { procs: [{ name: "node", pid: 1 }], user: "ana" });
  ok(get(plan(port, [], ubuntuOff).options, "firewall")!.blocked!.includes("apagado"), "ufw apagado: hay que activarlo antes");
  ok(get(plan(port, [], debian).options, "firewall")!.blocked!.includes("solo cambia firewalld y ufw"), "nftables: a mano");
  ok(get(plan(port, [], null, "ana", { firewallError: "sin sudo" }).options, "firewall")!.blocked === "sin sudo", "no se pudo leer");
  ok(get(plan(lp(3306, { procs: [{ name: "mysqld", pid: 5 }] }), [], rocky).options, "firewall")!.blocked!.includes("ya no deja llegar"), "ya bloqueado");
  eq(outsideZones(rocky), ["public"], "firewalld: la zona de docker0 no mira hacia fuera");
  const b = blockPort(rocky, 8080, "tcp", SSH);
  ok(b.kind === "plan" && b.plan.permanent[0].startsWith("firewall-cmd --permanent --zone=public --add-rich-rule=") && !!b.plan.alreadyIf, "firewalld: fijo al confirmar");
  if (b.kind === "plan") shOk(trialScript(b.plan, "t2"), "firewalld a prueba");
}

// ───────── Utilidades ─────────
eq(localPublish({ hostIp: "", hostPort: 5353, containerPort: 53, protocol: "udp" }), { now: "5353:53/udp", local: "127.0.0.1:5353:53/udp" }, "UDP");
eq(localPublish({ hostIp: "10.0.0.5", hostPort: 80, containerPort: 8080, protocol: "tcp" }), { now: "10.0.0.5:80:8080", local: "127.0.0.1:80:8080" }, "IP concreta");
const mapPorts = [lp(80, { scope: "local", ip: "127.0.0.1" }), lp(80)];
eq(portOfMapNode("srv1|port:tcp:80", mapPorts)?.scope, "public", "nodo del mapa → el puerto expuesto");
eq(portOfMapNode("srv1|proc:root:nginx", mapPorts), null, "otro nodo: nada");

console.log(`OK: ${n} pruebas de «Cerrar puerto»`);
