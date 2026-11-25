// Pruebas de «Arreglar» en la auditoría: volver a evaluar tras el arreglo, cruzar el informe guardado con
// lo nuevo y recalcular notas, separar arreglos seguros de peligrosos, la comprobación previa y el orden.
// Ejecutar: npx rolldown src/features/audit/fix.test.ts -p node -f esm -o /tmp/fx.mjs && node /tmp/fx.mjs
import type { AuditReport, Check } from "../../api/audit";
import type { PortsResult } from "../admin/ports";
import { runChecks, type AuditInput } from "./checks";
import { ROCKY_SERVER, UBUNTU_SERVER } from "./fixtures";
import { firewallKeepsPort, fixLevel, guardProblem, parseGuard, safeFixes, sshListenPorts, type GuardInfo } from "./fixSafety";
import { problemsByImportance, adviceFor } from "./priority";
import { fixSummary, mergeRecheck, recheckCategories, recheckOutcome, sshdCulprit } from "./recheck";
import { scoreChecks } from "./score";

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

const NOW = Date.parse("2026-11-16T12:00:00Z");

function sshPort(p: number, name = "sshd"): PortsResult["ports"][number] {
  return { key: `tcp|0.0.0.0|${p}`, proto: "tcp", ip: "0.0.0.0", iface: null, port: p, family: 4, scope: "public", procs: [{ name, pid: 1 }], user: "root", unit: null, container: null };
}
const PORTS: PortsResult = { tool: "ss", ports: [sshPort(2222), sshPort(443, "nginx")] };

function input(stdout: string, extra: Partial<AuditInput> = {}): AuditInput {
  return { stdout, elevated: true, ports: PORTS, web: null, vuln: null, now: NOW, ...extra };
}

function report(stdout: string): AuditReport {
  const { checks, os } = runChecks(input(stdout));
  return { id: "aud-1", serverId: "srv", createdAt: new Date(NOW).toISOString(), durationMs: 1, elevated: true, os, ...scoreChecks(checks), checks, ai: null };
}

const byId = (cs: Check[]) => new Map(cs.map((c) => [c.id, c]));

/** Lo mismo que el arreglo cambia en lo que lee la comprobación (salida de AUDIT_SCRIPT tras ejecutarlo). */
const AFTER_FIX: Record<string, (s: string) => string> = {
  "ssh.keys": (s) => s.replace("ana|1|664|", "ana|1|600|"),
  "ssh.password": (s) => s.replace("passwordauthentication yes", "passwordauthentication no"),
  "ssh.root": (s) => s.replace("permitrootlogin yes", "permitrootlogin no"),
  "net.firewall": (s) => s.replace("firewalld not running", "firewalld running"),
  "updates.pending": (s) => s.replace("dnf|42|7", "dnf|0|0"),
  "logins.fail2ban": (s) => s.replace("f2b none", "f2b active"),
  "hard.hidepid": (s) => s.replace("proc /proc proc rw,nosuid", "proc /proc proc rw,hidepid=invisible,nosuid"),
  "hard.shadow": (s) => s.replace("/etc/shadow 644 root root", "/etc/shadow 640 root root"),
  "hard.wwetc": (s) => s.replace("/etc/app/config.ini\n", ""),
  "hard.webconf": (s) => s.replace("/etc/nginx/nginx.conf\n/etc/nginx/ssl/tienda.key\n", ""),
};

// ───────── Cada arreglo automático, al volver a comprobar, queda bien ─────────
{
  const before = report(ROCKY_SERVER);
  const fixable = before.checks.filter((c) => fixLevel(c) === "auto" || fixLevel(c) === "confirm");
  for (const c of fixable) {
    const after = AFTER_FIX[c.id];
    if (c.id === "updates.reboot") continue;
    ok(after, `hay simulación del arreglo de ${c.id}`);
    if (!after) continue;
    const stdout = after(ROCKY_SERVER);
    ok(stdout !== ROCKY_SERVER, `la simulación de ${c.id} cambia algo`);
    const fresh = runChecks(input(stdout)).checks;
    const cats = recheckCategories([c]);
    const merged = mergeRecheck(before, fresh, cats);
    const o = recheckOutcome(c, byId(fresh).get(c.id), stdout);
    eq([o.state, o.reason], ["fixed", null], `${c.id}: arreglado al volver a comprobar`);
    ok(["ok", "info"].includes(byId(merged.checks).get(c.id)?.status ?? ""), `${c.id}: deja de ser un problema en el informe guardado`);
    const cat = (r: AuditReport) => r.categories.find((x) => x.id === c.category)?.score ?? 0;
    ok(cat(merged) >= cat(before), `${c.id}: la nota de la categoría no baja (${cat(before)} → ${cat(merged)})`);
    ok((merged.score ?? 0) >= (before.score ?? 0), `${c.id}: la nota general no baja`);
    eq(merged.id, before.id, `${c.id}: mismo informe (se guarda encima)`);
  }
}

// ───────── Cruce informe viejo / nuevo ─────────
{
  const before = report(ROCKY_SERVER);
  eq(recheckCategories([{ category: "ssh" }]), ["ssh", "logins"], "SSH arrastra fail2ban");
  eq(recheckCategories([{ category: "hardening" }, { category: "users" }]), ["users", "hardening"], "categorías en orden");

  // Varias cosas a la vez: la nota sube y el resumen cambia.
  const stdout = AFTER_FIX["hard.shadow"](AFTER_FIX["hard.wwetc"](AFTER_FIX["hard.webconf"](AFTER_FIX["hard.hidepid"](ROCKY_SERVER))));
  const merged = mergeRecheck(before, runChecks(input(stdout)).checks, ["hardening"]);
  eq(merged.categories.find((c) => c.id === "hardening")?.score, 100, "endurecimiento al 100");
  ok((merged.score ?? 0) > (before.score ?? 0), `la nota general sube (${before.score} → ${merged.score})`);
  ok(merged.summary !== before.summary, "el resumen se recalcula");
  eq(merged.checks.length, before.checks.length, "mismas comprobaciones");
  // Lo que no se volvió a comprobar se queda tal cual (aunque lo nuevo diga otra cosa).
  const other = runChecks(input(AFTER_FIX["ssh.keys"](stdout))).checks;
  eq(byId(mergeRecheck(before, other, ["hardening"]).checks).get("ssh.keys")?.status, "bad", "otras categorías no cambian");
  // Un «sin comprobar» (p. ej. sudo falló) no pisa un resultado de verdad.
  const skipped = runChecks(input(ROCKY_SERVER.replace("@@shadow\nroot:set", "@@shadow\n@noread\nroot:set"), { elevated: false })).checks;
  eq(byId(mergeRecheck(before, skipped, ["users"]).checks).get("users.empty")?.status, "bad", "sin comprobar no pisa");
  eq(recheckOutcome(byId(before.checks).get("users.empty")!, byId(skipped).get("users.empty"), "").state, "unknown", "sin comprobar = no se sabe");
  // El orden de categorías se mantiene.
  const order = mergeRecheck(before, runChecks(input(stdout)).checks, ["ssh"]).checks.map((c) => c.category);
  ok(order.indexOf("ssh") < order.indexOf("users") && order.lastIndexOf("ssh") < order.indexOf("users"), "SSH sigue primero");
}

// ───────── Si sigue mal, por qué ─────────
{
  // Ubuntu: SSHorus escribió 00-sshorus.conf pero sshd sigue con contraseña: lo pisa 50-cloud-init.
  const out = UBUNTU_SERVER.replace(
    "@@sshdcfg\n",
    "@@sshdcfg\n/etc/ssh/sshd_config.d/00-sshorus.conf:PasswordAuthentication no\n",
  );
  const before = byId(runChecks(input(UBUNTU_SERVER)).checks).get("ssh.password")!;
  const after = byId(runChecks(input(out)).checks).get("ssh.password");
  const o = recheckOutcome(before, after, out);
  eq(o.state, "same", "sshd: sigue igual");
  eq(o.reason, "otro archivo lo vuelve a activar: /etc/ssh/sshd_config.d/50-cloud-init.conf", "sshd: dice qué archivo lo pisa");
  eq(sshdCulprit("ssh.root", out), null, "root: ningún archivo lo pone");
  // Salida real (Debian, sshd de verdad): «PasswordAuthentication yes» en sshd_config por encima del Include.
  const above = "@@sshdcfg\n/etc/ssh/sshd_config.d/00-sshorus.conf:PasswordAuthentication no\n/etc/ssh/sshd_config.d/50-cloud-init.conf:PasswordAuthentication yes\n/etc/ssh/sshd_config:PasswordAuthentication yes\n@@end\n";
  eq(sshdCulprit("ssh.password", above), "otro archivo lo vuelve a activar: /etc/ssh/sshd_config", "sshd: lo pisa sshd_config (antes del Include)");
  // dnf: se instalaron las de seguridad, quedan otras: mejora.
  const dnf = ROCKY_SERVER.replace("dnf|42|7", "dnf|35|0");
  const b2 = byId(runChecks(input(ROCKY_SERVER)).checks).get("updates.pending")!;
  const o2 = recheckOutcome(b2, byId(runChecks(input(dnf)).checks).get("updates.pending"), dnf);
  eq(o2.state, "better", "dnf: mejora");
  ok(o2.reason?.includes("35 paquetes"), `dnf: dice lo que queda: ${o2.reason}`);
  const o3 = recheckOutcome(b2, byId(runChecks(input(ROCKY_SERVER)).checks).get("updates.pending"), ROCKY_SERVER);
  ok(o3.state === "same" && o3.reason?.startsWith("sigue igual:"), `sin cambios: ${o3.reason}`);
}

// ───────── Seguros y peligrosos ─────────
{
  const vuln = { createdAt: new Date(NOW).toISOString(), summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0, total: 1, withFix: 1, unimportant: 0 } };
  const extra = { tool: "ss" as const, ports: [...PORTS.ports, { ...sshPort(5432, "postgres"), key: "pg" }] };
  const checks = runChecks(input(ROCKY_SERVER, { vuln, ports: extra })).checks;
  const safe = safeFixes(checks).map((c) => c.id).sort();
  eq(safe, ["hard.shadow", "hard.wwetc", "logins.fail2ban", "ssh.keys", "updates.pending"], "arreglos seguros");
  for (const id of ["ssh.password", "ssh.root", "net.firewall", "updates.reboot", "hard.hidepid", "hard.webconf"]) {
    eq(fixLevel(byId(checks).get(id)!), "confirm", `${id}: aparte, con confirmación`);
  }
  for (const id of ["users.empty", "users.uid0", "users.nopasswd", "net.ports", "system.disk", "updates.vulns", "system.mem"]) {
    eq(fixLevel(byId(checks).get(id)!), "manual", `${id}: a mano`);
    ok(adviceFor(byId(checks).get(id)!), `${id}: explica qué hacer`);
  }
  eq(fixLevel(byId(checks).get("users.sudo")!), null, "lo informativo no es un problema");
}

// ───────── Comprobación previa (no quedarse fuera) ─────────
{
  const checks = byId(runChecks(input(ROCKY_SERVER)).checks);
  const g = (x: Partial<GuardInfo>): GuardInfo => ({ user: "ana", serverPort: 2222, keys: 1, auth: "key", ...x });
  const pw = checks.get("ssh.password")!;
  eq(guardProblem(pw, g({})), null, "contraseña: con llave se puede");
  ok(guardProblem(pw, g({ keys: 0 }))?.includes("no tiene ninguna llave"), "contraseña: sin llave, no");
  ok(guardProblem(pw, g({ auth: "password" }))?.includes("con contraseña"), "contraseña: SSHorus entra con contraseña, no");
  ok(guardProblem(checks.get("ssh.root")!, g({ user: "root" }))?.includes("como root"), "root: conectado como root, no");
  eq(guardProblem(checks.get("ssh.root")!, g({})), null, "root: con otro usuario, sí");
  const fw = checks.get("net.firewall")!;
  eq(guardProblem(fw, g({})), null, "cortafuegos: abre el 2222");
  ok(guardProblem(fw, g({ serverPort: 2200 }))?.includes("2200"), "cortafuegos: cerraría el puerto de esta conexión");
  eq(guardProblem(checks.get("hard.shadow")!, g({ keys: 0 })), null, "lo demás no necesita comprobación");
  eq(parseGuard("@@who\nana\n10.0.0.5 51234 10.0.0.1 2222\n@@keys\n3\n@@end\n", "key"), { user: "ana", serverPort: 2222, keys: 3, auth: "key" }, "lectura previa");
  eq(parseGuard("@@who\nana\n\n@@keys\n0\n@@end\n", null).serverPort, null, "sin SSH_CONNECTION");
  ok(firewallKeepsPort("firewall-cmd --permanent --add-service=ssh", 22), "firewalld: servicio ssh = 22");
  ok(!firewallKeepsPort("ufw allow 22222/tcp", 2222), "ufw: 22222 no es 2222");
  eq(sshListenPorts(PORTS, 22), [22, 2222], "puertos de sshd: el configurado y donde escucha");
  eq(sshListenPorts(null, 22), [22], "sin puertos leídos: el configurado");
  ok(runChecks(input(UBUNTU_SERVER, { ports: { tool: "ss", ports: [sshPort(22), sshPort(2222)] } })).checks.find((c) => c.id === "net.firewall")?.fix?.command.includes("ufw allow 22/tcp\nufw allow 2222/tcp"), "ufw abre todos los puertos de sshd");
}

// ───────── Orden: lo más importante primero ─────────
{
  const list = problemsByImportance(runChecks(input(ROCKY_SERVER)).checks);
  ok(list.length > 5, "hay problemas");
  ok(list.every((c) => c.status === "bad" || c.status === "warn"), "solo problemas");
  const firstWarn = list.findIndex((c) => c.status === "warn");
  ok(firstWarn > 0 && list.slice(firstWarn).every((c) => c.status === "warn"), "graves antes que avisos");
  eq(list[0].weight, 3, "primero, un grave de peso 3");
  ok(list.indexOf(list.find((c) => c.id === "ssh.root")!) < list.indexOf(list.find((c) => c.id === "system.disk")!), "root por SSH antes que el disco");
}

// ── Resultado en una frase (aviso de la tarea) ──
eq(fixSummary([{ id: "a", state: "fixed", reason: null }, { id: "b", state: "fixed", reason: null }], { score: 85, grade: "B", summary: "" }), "2 arreglados · Nota 85/100 (B)", "todo arreglado");
eq(fixSummary([{ id: "a", state: "fixed", reason: null }, { id: "b", state: "same", reason: "sshd no se reinició" }], { score: 70, grade: "C", summary: "" }), "1 arreglado, 1 sigue: Sshd no se reinició", "uno sigue, con su motivo");

console.log(`${passed} pruebas bien, ${failed} mal`);
if (failed) process.exit(1);
