// Pruebas del panel «Configuración»: script (reutiliza la Auditoría), SELinux y sus denegaciones,
// AppArmor, actualizaciones automáticas, fail2ban, sysctl y las secciones completas.
import { AUDIT_SCRIPT } from "../audit/script";
import { aaRows, parseAppArmor } from "./apparmor";
import { autoUpdSection, parseAutoUpd } from "./autoUpdates";
import { avcRow, explainAvc, groupAvc, parseAvcLine, webDirFor } from "./avc";
import { buildConfig } from "./build";
import { jailRows, parseFail2ban, unbanChange } from "./fail2ban";
import { AA_DENIED, AA_PROFILES, AUSEARCH, AUTOUPD_DEBIAN_OFF, AUTOUPD_ROCKY, F2B, JOURNAL_AVC, rockyOutput, SEBOOL, SESTATUS_ENFORCING, SYSCTL_ROCKY } from "./fixtures";
import { clientIp } from "./read";
import { CONFIG_SCRIPT, MISSING_AUDIT_SECTIONS, pickSections } from "./script";
import { modeChanges, parseBooleans, parseSelinux } from "./selinux";
import { parseSysctl, sysctlChange, sysctlPending } from "./sysctl";

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

// ───────── Script ─────────
eq(MISSING_AUDIT_SECTIONS, [], "todas las secciones de la Auditoría existen");
const p = pickSections("A=1\necho @@x; echo a\nb\necho @@y\nc\necho @@z", ["x", "z", "nada"]);
eq(p.lines, ["A=1", "echo @@x; echo a", "b", "echo @@z"], "pickSections: preámbulo y secciones elegidas en orden");
eq(p.missing, ["nada"], "pickSections: dice lo que falta");
ok(CONFIG_SCRIPT.includes("PATH=$PATH:/usr/sbin") && CONFIG_SCRIPT.includes("sshd -T"), "el script lleva el preámbulo y sshd -T de la Auditoría");
ok(!CONFIG_SCRIPT.includes("check-update") && !CONFIG_SCRIPT.includes("find /etc"), "no lleva las partes lentas de la Auditoría");
ok(CONFIG_SCRIPT.startsWith("renice -n 10"), "con poca prioridad");
ok(CONFIG_SCRIPT.trimEnd().endsWith("echo @@end"), "termina en @@end");
ok(AUDIT_SCRIPT.includes("echo @@fw"), "la Auditoría sigue teniendo @@fw");

// ───────── SELinux ─────────
const se = parseSelinux(SESTATUS_ENFORCING);
eq([se.present, se.mode, se.configMode, se.policy], [true, "enforcing", "enforcing", "targeted"], "sestatus enforcing");
eq(parseSelinux(["Current mode: Permissive", "cfg SELINUX=enforcing"]).mode, "permissive", "getenforce");
eq(parseSelinux(["Current mode: Disabled"]).present, false, "getenforce «Disabled» sin nada más: no hay SELinux");
eq(parseSelinux(["SELinux status:                 disabled", "cfg SELINUX=disabled"]).mode, "disabled", "desactivado");
eq(parseSelinux([]).present, false, "Debian: nada");
const bools = parseBooleans([...SEBOOL, "Error getting active value for nada", "otra_cosa --> on"]);
eq([...bools.entries()], [["httpd_can_network_connect", false], ["httpd_read_user_content", false], ["container_manage_cgroup", false], ["httpd_can_network_relay", true]], "booleans conocidos");
const perm = modeChanges({ ...se, mode: "permissive" }, 3);
eq(perm.map((c) => c.id), ["selinux.enforce", "selinux.persist"], "permissive: pasar a enforcing y guardar");
ok(perm[0].danger && /3 denegaciones/.test(perm[0].note ?? ""), "pasar a enforcing avisa de las denegaciones");
eq(modeChanges(se, 0).map((c) => c.steps), [["setenforce 0"]], "enforcing: permissive solo hasta reiniciar");

// ───────── Denegaciones ─────────
const d = parseAvcLine(AUSEARCH[1]);
eq([d?.time, d?.comm, d?.dest, d?.stype, d?.ttype, d?.tclass, d?.perms], [1795530540, "nginx", 8080, "httpd_t", "http_cache_port_t", "tcp_socket", ["name_connect"]], "línea de ausearch");
const j = parseAvcLine(JOURNAL_AVC[1]);
eq([j?.time, j?.comm, j?.tclass], [1795530473, "bash", "process2"], "línea del journal");
const groups = groupAvc(AUSEARCH);
eq(groups.length, 5, "las dos de nginx→8080 se juntan");
const proxy = groups.find((g) => g.sample.dest === 8080)!;
eq(proxy.count, 2, "cuenta las repetidas");
ok(/El servidor web \(nginx\) no pudo conectarse al puerto 8080.*2 veces/.test(explainAvc(proxy)), `explicación: ${explainAvc(proxy)}`);
const r1 = avcRow(proxy, bools);
eq(r1.change?.steps, ["setsebool -P httpd_can_network_connect 1"], "proxy → httpd_can_network_connect");
eq(avcRow(proxy, new Map([["httpd_can_network_connect", true]])).change, null, "ya activado: sin arreglo");
const ctr = avcRow(groups.find((g) => g.sample.stype === "container_t")!, bools);
ok(ctr.change === null && /:Z/.test(ctr.advice ?? ""), "contenedor sin :Z: consejo, sin arreglo automático");
const site = avcRow(groups.find((g) => g.sample.comm === "caddy")!, bools);
ok(site.change?.steps.some((s) => s.includes("'/srv/sitio(/.*)?'")) && site.change.steps.some((s) => s === "restorecon -Rv '/srv/sitio'"), "carpeta de la web → semanage fcontext + restorecon");
const bind = avcRow(groups.find((g) => g.sample.src === 8443)!, bools);
ok(bind.change?.steps.some((s) => s.includes("semanage port -a -t http_port_t -p tcp 8443")), "escuchar en 8443 → semanage port");
const shadow = avcRow(groups.find((g) => g.sample.path === "/etc/shadow")!, bools);
eq(shadow.change, null, "nunca etiqueta archivos del sistema");
ok(shadow.copy?.includes("audit2why") && shadow.copy.includes("-c 'nginx'"), "sin arreglo: comando para ver el motivo, citado");
eq(webDirFor({ ...d!, path: "/srv/a b/x.html", tclass: "file" }), "/srv/a b", "ruta con espacio");
eq(webDirFor({ ...d!, path: "/srv/../etc/x", tclass: "file" }), null, "sin «..»");
eq(webDirFor({ ...d!, path: "/var/x.html", tclass: "file" }), null, "no etiqueta /var entero");
eq(webDirFor({ ...d!, path: "/srv/x;rm -rf", tclass: "file" }), null, "caracteres raros: no");

// ───────── AppArmor ─────────
const aa = parseAppArmor(AA_PROFILES);
eq([aa.enabled, aa.modes.enforce, aa.complain], [true, 3, ["/usr/sbin/cupsd"]], "perfiles de AppArmor");
const aar = aaRows(AA_DENIED);
eq(aar.length, 1, "denegaciones de AppArmor juntas");
ok(/no dejó a nginx leer «\/srv\/www\/index.html» \(2 veces\)/.test(aar[0].detail), `AppArmor explicado: ${aar[0].detail}`);
eq(aar[0].copy, "aa-complain '/usr/sbin/nginx'", "AppArmor: comando citado");
eq(parseAppArmor(["enabled N"]).enabled, false, "AppArmor apagado");

// ───────── Actualizaciones ─────────
const upR = autoUpdSection(parseAutoUpd(AUTOUPD_ROCKY));
eq(upR.status, "ok", "Rocky con dnf-automatic");
ok(/las de seguridad/.test(upR.summary), upR.summary);
ok(upR.notes.some((n) => /podman/.test(n)), "avisa de podman con «solo seguridad»");
eq(upR.changes.map((c) => c.label), ["Cambiar a «todo»", "Desactivar"], "cambios con dnf-automatic activo");
const upD = autoUpdSection(parseAutoUpd(AUTOUPD_DEBIAN_OFF));
eq([upD.status, upD.changes.map((c) => c.id)], ["warn", ["updates.apt"]], "Debian sin unattended-upgrades");
eq(autoUpdSection(parseAutoUpd(["pm apk", "systemd no"])).status, "na", "Alpine: no aplica");
eq(autoUpdSection(parseAutoUpd(["pm zypper", "systemd yes"])).status, "na", "openSUSE: no aplica");
eq(autoUpdSection(parseAutoUpd(["pm dnf", "systemd no"])).changes, [], "sin systemd no se ofrece activarlo");

// ───────── fail2ban ─────────
const f2 = parseFail2ban(F2B);
eq([f2.running, f2.jails.map((x) => x.name), f2.jails[1].banned, f2.jails[1].failedTotal], [true, ["nginx-http-auth", "sshd"], ["203.0.113.7", "198.51.100.23"], 412], "fail2ban-client");
const jr = jailRows(f2, "198.51.100.23");
eq(jr.length, 4, "dos cárceles y dos bloqueadas");
ok(jr[3].status === "bad" && /te conectas/.test(jr[3].detail), "avisa si la bloqueada es tu IP");
eq(jr[2].change?.steps, ["fail2ban-client set 'sshd' unbanip '203.0.113.7'"], "desbloquear, citado");
eq(unbanChange("sshd", "1.2.3.4; reboot"), null, "IP rara: no");
eq(parseFail2ban(["@none"]).installed, false, "no instalado");

// ───────── sysctl ─────────
const sv = parseSysctl(SYSCTL_ROCKY);
const pend = sysctlPending(sv).map((k) => k.key);
ok(!pend.includes("net.ipv4.ip_forward") && !pend.includes("net.ipv4.conf.all.rp_filter"), "ip_forward y rp_filter=1 no se tocan");
eq(pend.length, 7, "pendientes");
const sc = sysctlChange(sysctlPending(sv));
ok(sc?.steps[0].includes("> /etc/sysctl.d/90-sshorus-red.conf") && sc.steps[1] === "sysctl -p /etc/sysctl.d/90-sshorus-red.conf", "archivo propio y aplicar");

// ───────── Todo junto ─────────
eq(clientIp("@@who\nleo\n198.51.100.23 51022 10.0.0.5 2222\n@@keys\n1\n@@end\n"), "198.51.100.23", "IP de esta conexión");
eq(clientIp("@@who\nleo\n\n@@end\n"), null, "sin SSH_CONNECTION");
const cfg = buildConfig(rockyOutput(), true, "198.51.100.23");
const by = Object.fromEntries(cfg.sections.map((s) => [s.id, s]));
eq(cfg.sections.map((s) => s.id), ["mac", "ssh", "firewall", "updates", "fail2ban", "sudo", "sysctl", "hidepid"], "orden de las secciones");
eq([by.mac.title, by.mac.status], ["SELinux", "warn"], "SELinux con denegaciones");
ok(by.mac.groups[0].rows.length === 5 && by.mac.groups[1].rows.length === 4, "denegaciones y booleans");
eq(by.ssh.status, "bad", "root entra con contraseña");
ok(by.ssh.checks.find((c) => c.id === "ssh.root")?.fix?.danger, "el arreglo de root viene de la Auditoría y es peligroso");
eq(by.firewall.status, "ok", "firewalld activo");
eq(by.firewall.link, "firewall", "enlace al mapa");
ok(by.fail2ban.status === "ok" && /2 direcciones bloqueadas/.test(by.fail2ban.summary), by.fail2ban.summary);
ok(by.fail2ban.notes.some((n) => /2222/.test(n)), "avisa del puerto de SSH en la cárcel");
ok(by.sudo.status === "warn" && by.sudo.facts[0].value === "leo", "sudo: NOPASSWD y miembros de wheel");
eq(by.sysctl.status, "warn", "sysctl con pendientes");
ok(by.hidepid.status === "warn" && by.hidepid.checks[0].fix !== null, "hidepid con el arreglo de la Auditoría");
const noSudo = buildConfig("@@id\n1000 leo\nleo wheel\n@@os\ndebian||Debian 12\n@@sshdsrc\nF\n@@sshdcfg\n@noread\n@@fw\nufw ?\n@@fban\n@noread\n@@autoupd\npm apt-get\n@@end\n", false, null);
const nb = Object.fromEntries(noSudo.sections.map((s) => [s.id, s]));
eq([nb.mac.status, nb.ssh.status, nb.firewall.status], ["na", "skip", "skip"], "sin sudo: no aplica o sin leer");
ok(nb.ssh.notes.some((n) => /sudo/.test(n)) && nb.fail2ban.notes.some((n) => /sudo/.test(n)), "sin sudo dice qué falta");
const odd = cfg.sections.concat(noSudo.sections).filter((s) => /undefined|NaN|null/.test(`${s.summary} ${s.facts.map((f) => f.value).join(" ")}`));
eq(odd.map((s) => s.id), [], "sin textos rotos");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
