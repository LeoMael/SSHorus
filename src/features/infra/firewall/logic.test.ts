// Pruebas de las decisiones del cortafuegos: si se llega a un puerto, el cruce con los puertos en
// escucha, la protección para no quedarse fuera, los comandos (con sus comillas) y los scripts a prueba.
import type { ListenPort } from "../../admin/ports";
import { confirmScript, planChange, trialScript, undoScript, type FwPlan } from "./commands";
import { crossCheck } from "./crosscheck";
import { DEBIAN, OLD_SERVER, ROCKY, UBUNTU, UBUNTU_OFF } from "./fixtures";
import { formTarget, EMPTY_FORM } from "./form";
import { lockoutProblem, loginCheck, parseSshConnection, sshGuard, sshPortsToOpen } from "./lockout";
import { reach } from "./reach";
import { parseFirewallReport } from "./report";

// Módulos de Node sin sus tipos (la interfaz no los tiene), como en las demás pruebas que ejecutan sh.
const nodeModule = (name: string) => import(/* @vite-ignore */ name);
const { spawnSync } = await nodeModule("node:child_process");

let n = 0;
function eq(got: unknown, want: unknown, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  n++;
}
const tcp = (port: number, from: string | null = null, localIp: string | null = null) => ({ port, proto: "tcp" as const, from, localIp });

const rocky = parseFirewallReport(ROCKY);
const ubuntu = parseFirewallReport(UBUNTU);
const deb = parseFirewallReport(DEBIAN);
const old = parseFirewallReport(OLD_SERVER);

// ───────── ¿Se llega al puerto? ─────────
eq(reach(rocky, tcp(22)), "allowed", "firewalld: ssh por el servicio");
eq(reach(rocky, tcp(5432)), "blocked", "firewalld: 5432 solo para la red interna");
eq(reach(rocky, tcp(5432, "10.1.2.3")), "allowed", "firewalld: 5432 desde la red interna");
eq(reach(rocky, tcp(22, "203.0.113.66")), "blocked", "firewalld: el rechazo enriquecido va antes que los servicios");
eq(reach(rocky, tcp(3306, null, "10.0.0.5")), "blocked", "firewalld: zona de la interfaz eth0");
eq(reach(rocky, tcp(3306, null, "172.17.0.1")), "allowed", "firewalld: zona docker (ACCEPT)");
eq(reach(ubuntu, tcp(22)), "allowed", "ufw: limit deja pasar");
eq(reach(ubuntu, tcp(3306)), "blocked", "ufw: política por defecto");
eq(reach(ubuntu, tcp(80, "203.0.113.4")), "allowed", "ufw: la primera que encaja decide (80 va antes del bloqueo)");
eq(reach(ubuntu, tcp(3306, "203.0.113.4")), "blocked", "ufw: bloqueo de un origen");
eq(reach(ubuntu, tcp(3000)), "unknown", "ufw: regla de interfaz = no se sabe");
eq(reach(deb, tcp(22)), "allowed", "nft: 22");
eq(reach(deb, tcp(443)), "allowed", "nft: por la cadena web");
eq(reach(deb, tcp(5432)), "blocked", "nft: política drop");
eq(reach(deb, tcp(5432, "10.9.9.9")), "allowed", "nft: origen permitido");
eq(reach(old, tcp(2222)), "allowed", "iptables: 2222");
eq(reach(old, tcp(23)), "blocked", "iptables: 23 rechazado");
eq(reach(old, tcp(443, "192.168.5.5")), "allowed", "iptables: multiport desde la red");
eq(reach(parseFirewallReport(UBUNTU_OFF), tcp(3306)), "allowed", "cortafuegos apagado: todo pasa");
eq(reach({ ...rocky, readable: false }, tcp(22)), "unknown", "sin sudo no se sabe");

// ───────── Cruce con los puertos en escucha ─────────
function listen(port: number, scope: ListenPort["scope"], proc = "sshd", proto: "tcp" | "udp" = "tcp"): ListenPort {
  return { key: `${proto}${port}`, proto, ip: scope === "local" ? "127.0.0.1" : "0.0.0.0", iface: null, port, family: 4, scope, procs: [{ name: proc, pid: 1 }], user: "root", unit: null, container: null };
}
const ports = [listen(22, "public"), listen(5432, "public", "postgres"), listen(9090, "local", "cockpit-ws"), listen(8081, "public", "docker-proxy")];
eq(
  crossCheck(rocky, ports).map((f) => [f.kind, f.port]),
  [["listen-blocked", 5432], ["docker-bypass", 8081], ["open-local", 9090], ["open-idle", 8080]],
  "escucha pero bloqueado, Docker por su cuenta, solo local y abierto sin nada",
);
eq(crossCheck(rocky, ports)[0].text, "5432/tcp (PostgreSQL) escucha, pero el cortafuegos no deja llegar desde fuera.", "texto del aviso");
eq(crossCheck(rocky, null), [], "sin puertos leídos, sin avisos");

// ───────── No quedarse fuera ─────────
eq(parseSshConnection("198.51.100.7 51000 10.0.0.5 22"), { clientIp: "198.51.100.7", serverIp: "10.0.0.5", serverPort: 22 }, "SSH_CONNECTION");
eq(parseSshConnection(""), null, "sin SSH_CONNECTION");
const guard = sshGuard(parseSshConnection("198.51.100.7 51000 10.0.0.5 22"), 2222, [22]);
eq(guard.ports, [22], "el puerto de la conexión manda sobre el del perfil (NAT)");
const sshSvc = rocky.rules.find((r) => r.service === "ssh")!;
eq(typeof lockoutProblem(rocky, { kind: "remove", rule: sshSvc }, guard), "string", "firewalld: no se deja quitar el servicio ssh");
eq(lockoutProblem(rocky, { kind: "remove", rule: rocky.rules.find((r) => r.raw === "ports: 8080/tcp")! }, guard), null, "quitar 8080 no afecta");
const withPort = { ...rocky, rules: [...rocky.rules, { ...sshSvc, id: "extra", service: null, ports: [{ from: 22, to: 22 }], proto: "tcp" }] };
eq(lockoutProblem(withPort, { kind: "remove", rule: sshSvc }, guard), null, "si otra regla abre el 22, sí se puede");
const ufwGuard = sshGuard(null, 22, []);
eq(typeof lockoutProblem(ubuntu, { kind: "remove", rule: ubuntu.rules[0] }, ufwGuard), "string", "ufw: no se deja quitar el 22");
eq(lockoutProblem(ubuntu, { kind: "remove", rule: ubuntu.rules[1] }, ufwGuard), null, "ufw: quitar 80,443 sí");
eq(sshPortsToOpen(parseFirewallReport(UBUNTU_OFF), ufwGuard), [22], "activar ufw: falta abrir el 22");
eq(sshPortsToOpen({ ...ubuntu, active: false }, ufwGuard), [], "activar ufw: el 22 ya está guardado (limit)");
eq(loginCheck(null), "ok", "conexión nueva bien");
eq(loginCheck("AuthFailed"), "ok", "pide otra credencial: el puerto responde");
eq(loginCheck("Network"), "blocked", "error de red: cerrado");
eq(loginCheck("Unknown"), "unclear", "otro error: no se sabe");

// ───────── Comandos ─────────
const plan = (p: ReturnType<typeof planChange>): FwPlan => {
  if ("error" in p) throw new Error(p.error);
  return p;
};
const add443 = plan(planChange(rocky, { kind: "add", target: { kind: "port", ports: { from: 443, to: 443 }, proto: "tcp", source: null }, zone: null }, "10.0.0.5"));
eq(
  [add443.apply, add443.revert, add443.permanent, add443.trial, add443.checkLogin],
  [["firewall-cmd --zone=public --add-port=443/tcp"], ["firewall-cmd --zone=public --remove-port=443/tcp"], ["firewall-cmd --permanent --zone=public --add-port=443/tcp"], true, false],
  "firewalld: abrir 443 a prueba en la zona de la conexión",
);
const fromIp = plan(planChange(rocky, { kind: "add", target: { kind: "port", ports: { from: 8000, to: 8010 }, proto: "udp", source: "203.0.113.4" }, zone: "public" }));
eq(fromIp.apply, [`firewall-cmd --zone=public --add-rich-rule='rule family="ipv4" source address="203.0.113.4" port port="8000-8010" protocol="udp" accept'`], "regla enriquecida citada");
const evil = plan(planChange(rocky, { kind: "add", target: { kind: "service", name: "http", source: null }, zone: "x;rm -rf /" }));
eq(evil.apply, ["firewall-cmd --zone='x;rm -rf /' --add-service=http"], "zona con caracteres raros, citada");
const rmRich = plan(planChange(rocky, { kind: "remove", rule: rocky.rules[0] }));
eq(rmRich.apply, [`firewall-cmd --zone=public --remove-rich-rule='rule family="ipv4" source address="203.0.113.66" drop'`], "quitar regla enriquecida");
eq([rmRich.trial, rmRich.checkLogin], [true, true], "quitar: a prueba y probando a entrar");
const ufwAdd = plan(planChange(ubuntu, { kind: "add", target: { kind: "port", ports: { from: 5432, to: 5432 }, proto: "tcp", source: "10.0.0.0/8" }, zone: null }));
eq([ufwAdd.apply, ufwAdd.trial], [["ufw allow from 10.0.0.0/8 to any port 5432 proto tcp"], false], "ufw: abrir no necesita prueba");
const ufwRm = plan(planChange(ubuntu, { kind: "remove", rule: ubuntu.rules[4] }));
eq(ufwRm.apply[1], "ufw delete allow 'Nginx Full'", "ufw: quitar un perfil con espacio");
eq(ufwRm.revert.join(" ").includes("ufw allow"), false, "ufw: deshacer no la añade al final (cambiaría el orden): vuelven las reglas de antes");
// Abrir lo que ya está (o se solapa): deshacerlo quitaría también lo de antes (con «ssh», te quedarías fuera).
const addTo = (target: Parameters<typeof planChange>[1] & { kind: "add" }) => planChange(rocky, target);
eq("error" in addTo({ kind: "add", target: { kind: "service", name: "ssh", source: null }, zone: "public" }), true, "firewalld: «ssh» ya está en la zona");
eq("error" in addTo({ kind: "add", target: { kind: "port", ports: { from: 9005, to: 9020 }, proto: "udp", source: null }, zone: "public" }), true, "firewalld: se solapa con 9000-9010/udp");
eq("error" in addTo({ kind: "add", target: { kind: "port", ports: { from: 9005, to: 9005 }, proto: "tcp", source: null }, zone: "public" }), false, "otro protocolo: sí");
eq(add443.alreadyIf, "firewall-cmd --zone=public --query-port=443/tcp", "y en el servidor se mira antes de tocar nada");
const ufwOn = plan(planChange(parseFirewallReport(UBUNTU_OFF), { kind: "enable", sshPorts: [22] }));
eq(ufwOn.apply, ["ufw allow 22/tcp", "ufw --force enable"], "activar ufw abre antes el 22");
const fwdOn = plan(planChange({ ...rocky, active: false }, { kind: "enable", sshPorts: [2222] }));
eq(fwdOn.apply, ["firewall-offline-cmd --zone=public --add-port=2222/tcp", "systemctl enable --now firewalld"], "activar firewalld con el puerto de SSH ya abierto");
eq("error" in planChange(deb, { kind: "remove", rule: deb.rules[2] }), true, "nftables: solo lectura");
eq("error" in planChange(deb, { kind: "remove", rule: deb.managed[0] }), true, "regla de Docker: no");
eq("error" in planChange(ubuntu, { kind: "remove", rule: ubuntu.rules[6] }), true, "regla de interfaz: a mano");

// ───────── Scripts a prueba ─────────
const trial = trialScript(rmRich, "job-1;x", 300);
eq(trial.includes("M=/run/sshorus-fw-job-1x"), true, "la marca no lleva caracteres raros");
eq(trial.indexOf("setsid") < trial.indexOf("--remove-rich-rule"), true, "la vuelta atrás se arma antes de aplicar");
for (const [what, s] of [["prueba", trial], ["confirmar", confirmScript(rmRich, "a")], ["deshacer", undoScript(rmRich, "a")]] as const) {
  const r = spawnSync("sh", ["-n"], { input: s });
  eq(r.status, 0, `script de ${what}: sintaxis de sh correcta`);
}
eq(confirmScript(rmRich, "a").includes("--permanent --zone=public --remove-rich-rule="), true, "confirmar lo deja fijo");

// De verdad, con firewall-cmd y ufw falsos y la marca en una carpeta temporal (en vez de /run y /etc/ufw).
const fs = await nodeModule("node:fs");
const { tmpdir } = await nodeModule("node:os");
const tmp: string = fs.mkdtempSync(`${tmpdir()}/sshorus-fw-`);
const FAKE_FWD = `#!/bin/sh\necho "firewall-cmd $*" >> ${tmp}/log\ncase "$*" in *--query-*) [ -e ${tmp}/ya ] && exit 0; exit 1 ;; esac\n`;
const FAKE_UFW = `#!/bin/sh\necho "ufw $*" >> ${tmp}/log\n[ "$1" = delete ] && sed -i '/Nginx Full/d' ${tmp}/etc-ufw/user.rules\nexit 0\n`;
const run = (script: string) =>
  spawnSync("sh", ["-c", script.replaceAll("/run/", `${tmp}/`).replaceAll("/etc/ufw/", `${tmp}/etc-ufw/`)], { encoding: "utf8", env: { PATH: `${tmp}:/usr/bin:/bin` } });
const log = (): string[] => (fs.existsSync(`${tmp}/log`) ? fs.readFileSync(`${tmp}/log`, "utf8").trim().split("\n") : []);
const wait = (secs: number) => spawnSync("sleep", [String(secs)]);
try {
  fs.mkdirSync(`${tmp}/etc-ufw`);
  for (const [name, body] of [["firewall-cmd", FAKE_FWD], ["ufw", FAKE_UFW]]) {
    fs.writeFileSync(`${tmp}/${name}`, body);
    fs.chmodSync(`${tmp}/${name}`, 0o755);
  }
  eq(run(trialScript(add443, "t1", 1)).status, 0, "a prueba: aplicado");
  eq(run(undoScript(add443, "t1")).status, 0, "deshacer ahora");
  eq(run(confirmScript(add443, "t1")).status, 3, "confirmar después de deshacer: ya no hay nada que confirmar");
  wait(1.5);
  eq(
    log(),
    ["firewall-cmd --zone=public --query-port=443/tcp", "firewall-cmd --zone=public --add-port=443/tcp", "firewall-cmd --zone=public --remove-port=443/tcp"],
    "se deshace una sola vez (la vuelta atrás del servidor ve que ya se hizo)",
  );
  fs.writeFileSync(`${tmp}/ya`, "");
  eq(run(trialScript(add443, "t2", 1)).status, 4, "ya estaba abierto en el servidor: no se toca nada");
  eq(log().length, 4, "ni se añade ni queda nada que deshacer");
  fs.rmSync(`${tmp}/ya`);
  eq(run(trialScript(add443, "t3", 1)).status, 0, "a prueba otra vez");
  wait(1.5);
  eq(log().slice(-1), ["firewall-cmd --zone=public --remove-port=443/tcp"], "sin confirmar, el servidor lo deshace solo");
  eq(run(confirmScript(add443, "t3")).status, 3, "y confirmar tarde lo dice");

  // ufw: quitar la 2.ª de tres y deshacer deja las reglas como estaban (mismo orden, con su comentario).
  const rules = "### tuple ### allow tcp 22 0.0.0.0/0 any 1.2.3.4 in\n### tuple ### allow tcp 80,443 0.0.0.0/0 any 0.0.0.0/0 Nginx Full - in # web\n### tuple ### deny tcp 22 0.0.0.0/0 any 0.0.0.0/0 in\n";
  fs.writeFileSync(`${tmp}/etc-ufw/user.rules`, rules);
  fs.writeFileSync(`${tmp}/etc-ufw/user6.rules`, "");
  eq(run(trialScript(ufwRm, "u1", 2)).status, 0, "ufw: quitada a prueba");
  eq(fs.readFileSync(`${tmp}/etc-ufw/user.rules`, "utf8").includes("Nginx Full"), false, "ufw: ya no está");
  eq(run(undoScript(ufwRm, "u1")).status, 0, "ufw: deshacer");
  eq(fs.readFileSync(`${tmp}/etc-ufw/user.rules`, "utf8"), rules, "ufw: las reglas de antes, tal cual");
  eq(fs.existsSync(`${tmp}/sshorus-fw-u1.d`), false, "sin copias olvidadas");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ───────── Formulario ─────────
eq(formTarget({ ...EMPTY_FORM, port: "443" }), { target: { kind: "port", ports: { from: 443, to: 443 }, proto: "tcp", source: null } }, "puerto");
eq("error" in formTarget({ ...EMPTY_FORM, port: "80,443" }), true, "una lista no: un puerto o un rango");
eq("error" in formTarget({ ...EMPTY_FORM, port: "443", source: "mi casa" }), true, "origen que no es IP");
for (const bad of ["1.2.3.4/", "1.2.3.4/ 8", "1.2.3.4/0x8", "10.0.0.0/8/9"]) eq("error" in formTarget({ ...EMPTY_FORM, port: "443", source: bad }), true, `origen mal escrito: «${bad}»`);
eq(formTarget({ ...EMPTY_FORM, port: "443", source: "10.0.0.0/8" }), { target: { kind: "port", ports: { from: 443, to: 443 }, proto: "tcp", source: "10.0.0.0/8" } }, "red bien escrita");
eq(formTarget({ ...EMPTY_FORM, kind: "service", service: "https", source: "2001:db8::/32" }), { target: { kind: "service", name: "https", source: "2001:db8::/32" } }, "servicio con origen IPv6");
eq("error" in formTarget({ ...EMPTY_FORM, kind: "service", service: "a'b" }), true, "nombre de servicio raro");

console.log(`firewall (decisiones): ${n} comprobaciones OK`);
