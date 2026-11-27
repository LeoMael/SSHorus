// Pruebas de Servicios: lectura de systemd (Rocky 9, Debian 12, con y sin columna PRESET) y de OpenRC
// (Alpine), servicios `--user`, acciones según el estado, comandos (también como otro usuario) y la
// protección de SSH. Los scripts se comprueban con `sh -n`.
import { actionsFor, isSshService, serviceChange } from "./actions";
import { countStates, mergeSystemd, parseOpenrc, parseServices, parseUserServices, type Service } from "./parse";
import { logsScript, SERVICES_SCRIPT, USER_SERVICES_SCRIPT, userServicesAsRoot, validUnit } from "./script";

const CHILD = "node:child_process";
const { spawnSync } = (await import(/* @vite-ignore */ CHILD)) as {
  spawnSync: (cmd: string, args: string[], opts: { encoding: "utf8"; input?: string }) => { status: number | null; stderr: string };
};

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}
function syntax(script: string, what: string) {
  const r = spawnSync("sh", ["-n"], { encoding: "utf8", input: script });
  ok(r.status === 0, `${what}: sh -n falló: ${r.stderr}`);
}

// ───────── systemd (Rocky 9, systemd 252: con PRESET) ─────────
const ROCKY_UNITS = [
  "  auditd.service                         loaded    active   running Security Auditing Service",
  "  caddy.service                          loaded    failed   failed  Caddy",
  "  chronyd.service                        loaded    active   running NTP client/server",
  "  dnf-makecache.service                  loaded    inactive dead    dnf makecache",
  "● nfs-server.service                     not-found inactive dead    nfs-server.service",
  "  getty@tty1.service                     loaded    active   running Getty on tty1",
  "  sshd.service                           loaded    active   running OpenSSH server daemon",
  "  podman-restart.service                 loaded    activating start Podman Start All Containers With Restart Policy",
];
const ROCKY_FILES = [
  "auditd.service                             enabled         enabled",
  "autovt@.service                            alias           -",
  "caddy.service                              enabled         disabled",
  "chronyd.service                            enabled         enabled",
  "dnf-makecache.service                      static          -",
  "getty@.service                             enabled         enabled",
  "sshd.service                               enabled         enabled",
  "podman.service                             disabled        disabled",
  "debug-shell.service                        masked          disabled",
  "podman-restart.service                     disabled        disabled",
];
const rocky = mergeSystemd(ROCKY_UNITS, ROCKY_FILES);
const by = Object.fromEntries(rocky.map((s) => [s.name, s]));
eq(Object.keys(by).sort(), ["auditd", "caddy", "chronyd", "debug-shell", "dnf-makecache", "getty@tty1", "podman", "podman-restart", "sshd"], "unidades sin plantillas ni las que no existen");
eq([by.caddy.state, by.caddy.boot, by.caddy.raw], ["failed", "enabled", "failed"], "caddy caído y activado al encender");
eq([by.sshd.state, by.sshd.description], ["running", "OpenSSH server daemon"], "sshd activo con su descripción");
eq([by.podman.state, by.podman.boot, by.podman.raw], ["stopped", "disabled", "inactive"], "podman solo en list-unit-files: parado");
eq([by["dnf-makecache"].boot, by["debug-shell"].boot], ["static", "masked"], "estático y bloqueado");
eq(by["podman-restart"].state, "starting", "arrancando");
eq(by["getty@tty1"].boot, null, "una instancia no tiene su propia línea en list-unit-files");
eq(countStates(rocky).failed, 1, "un caído");

// ───────── systemd viejo (CentOS 8 / systemd 239, sin PRESET) y Debian 12 ─────────
const old = mergeSystemd(["nginx.service loaded active running A high performance web server"], ["nginx.service enabled", "ssh.service enabled enabled"]);
eq(old.map((s) => [s.name, s.state, s.boot]), [["nginx", "running", "enabled"], ["ssh", "stopped", "enabled"]], "sin columna PRESET");
const debian = parseServices(
  [
    "@@me", "leo", "@@init", "systemd",
    "@@units", "cron.service loaded active running Regular background program processing daemon", "ssh.service loaded active running OpenBSD Secure Shell server",
    "@@files", "cron.service enabled enabled", "ssh.service enabled enabled", "ssh@.service static -",
    "@@humans", "leo|1000|/home/leo|1", "ana|1001|/home/ana|0", "roto|x|/home/roto|1",
    "@@end",
  ].join("\n"),
);
eq([debian.init, debian.me, debian.services.length], ["systemd", "leo", 2], "Debian: init, usuario y servicios");
eq(debian.humans, [{ name: "leo", uid: 1000, home: "/home/leo", runtimeDir: true }, { name: "ana", uid: 1001, home: "/home/ana", runtimeDir: false }], "usuarios (sin los rotos)");
eq(parseServices("@@me\nroot\n@@init\nnone\n@@humans\n@@end\n").services, [], "sin systemd ni OpenRC: no aplica");

// ───────── OpenRC (Alpine) ─────────
const ESC = String.fromCharCode(27);
const rc = parseOpenrc(
  [" sshd                                                       [  started  ]", ` crond ${ESC}[0;32m[  crashed  ]${ESC}[0m`, " nginx                                                      [  stopped  ]"],
  ["                 sshd |      default", "                crond |      default", "                nginx |"],
);
eq(rc.map((s) => [s.name, s.state, s.boot]), [["crond", "failed", "enabled"], ["nginx", "stopped", "disabled"], ["sshd", "running", "enabled"]], "OpenRC con colores");
eq(actionsFor(rc[1], "openrc", null), ["start", "enable"], "OpenRC parado: arrancar y activar");
const rcCh = serviceChange(rc[1], "enable", { init: "openrc", user: null });
eq(rcCh?.steps, ["rc-update add 'nginx' default"], "rc-update");

// ───────── Servicios --user ─────────
const us = parseUserServices("@@ok\n@@units\npodman-compose@web.service loaded active running podman-compose web\n@@files\npodman-compose@.service disabled enabled\n@@end\n");
eq(us?.map((s) => s.unit), ["podman-compose@web.service"], "servicios del usuario");
eq(parseUserServices("@@err\nFailed to connect to bus: No medium found\n@@end\n"), null, "sin gestor de usuario");

// ───────── Acciones y comandos ─────────
eq(actionsFor(by.caddy, "systemd", null), ["start", "restart", "disable"], "caído: arrancar, reiniciar, desactivar");
eq(actionsFor(by.sshd, "systemd", null), ["stop", "restart", "disable"], "activo");
eq(actionsFor(by["debug-shell"], "systemd", null), ["unmask"], "bloqueado: solo desbloquear");
eq(serviceChange(by.caddy, "restart", { init: "systemd", user: null })?.steps, ["systemctl restart 'caddy.service'"], "reiniciar");
const stopSsh = serviceChange(by.sshd, "stop", { init: "systemd", user: null });
ok(stopSsh?.danger && /nadie podrá volver a entrar/.test(stopSsh.note ?? ""), "parar SSH: aviso fuerte y confirmación");
ok(serviceChange(by.sshd, "disable", { init: "systemd", user: null })?.danger, "desactivar SSH también");
const rs = serviceChange(by.sshd, "restart", { init: "systemd", user: null });
ok(!rs?.danger && rs?.steps.some((s) => /sshd -t$/.test(s)) && rs.steps.at(-1) === "systemctl restart 'sshd.service'", "reiniciar SSH comprueba antes sshd -t");
ok(["sshd", "ssh.service", "sshd@abc.service", "dropbear"].every(isSshService) && !isSshService("sshguard.service"), "qué es SSH");
ok(serviceChange({ ...by.chronyd, unit: "systemd-networkd.service", name: "systemd-networkd" }, "stop", { init: "systemd", user: null })?.danger, "pieza del sistema");
const ana = { name: "ana", uid: 1001, home: "/home/ana", runtimeDir: true };
eq(
  serviceChange(us![0], "restart", { init: "systemd", user: ana })?.steps,
  ["runuser -u ana -- env HOME=/home/ana XDG_RUNTIME_DIR=/run/user/1001 systemctl --user restart podman-compose@web.service"],
  "como otro usuario",
);
const ssu = serviceChange(us![0], "stop", { init: "systemd", user: ana, runuser: false })?.steps[0] ?? "";
ok(ssu.startsWith("su -s /bin/sh ana -c "), `sin runuser, con su: ${ssu}`);
const evil: Service = { ...by.caddy, unit: "x;rm -rf /.service" };
eq(serviceChange(evil, "stop", { init: "systemd", user: null }), null, "nombre raro: no hay comando");
ok(validUnit("dev-disk-by\\x2duuid.service", "systemd") && !validUnit("a b.service", "systemd") && !validUnit("$(id)", "openrc"), "validar nombres");

// ───────── Registro y scripts ─────────
ok(logsScript({ init: "systemd", unit: "caddy.service", user: null }).includes("journalctl -u 'caddy.service' --no-pager -o short-iso -n 200"), "registro del sistema");
ok(logsScript({ init: "systemd", unit: "web.service", user: ana }).includes("--user-unit='web.service' _UID=1001"), "registro de un servicio de usuario (como root)");
ok(/timeout 300/.test(logsScript({ init: "systemd", unit: "caddy.service", user: null }, 0, true)), "seguir en vivo con tope");
syntax(SERVICES_SCRIPT, "SERVICES_SCRIPT");
syntax(USER_SERVICES_SCRIPT, "USER_SERVICES_SCRIPT");
syntax(userServicesAsRoot(ana), "userServicesAsRoot");
syntax(logsScript({ init: "systemd", unit: "caddy.service", user: null }, 0, true), "logs en vivo");

console.log(`servicios: ${passed} pruebas bien`);
