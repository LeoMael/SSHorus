// Pruebas de «Reiniciar ahora»: detección de «falta reiniciar», comandos y progreso.
// Ejecutar: npx rolldown src/features/reboot/reboot.test.ts -p node -f esm -o /tmp/rb.mjs && node /tmp/rb.mjs
import type { PrivilegeInfo } from "../privileges";
import { parseStatus, rebootAccess, rebootCommand, rebootedBetween, rebootSent, statusScript, type ServerStatus } from "./commands";
import { rebootPending } from "./detect";
import { BACK_LIMIT_MS, DOWN_LIMIT_MS, formatElapsed, isActive, newRun, phaseDetail, rebootStep, resultText, serverKey, stepStates, stillPending, type RebootEvent, type RebootRun } from "./progress";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// ── ¿Falta reiniciar? ──
eq(rebootPending(["required", "kernel 6.8.0-45", "mod 6.8.0-45", "mod 6.8.0-49"]).state, "required", "Debian: reboot-required");
eq(rebootPending(["nr 1", "kernel 5.14.0-1"]).state, "required", "RHEL: needs-restarting -r = 1");
eq(rebootPending(["nr 0", "kernel 5.14.0-1"]).state, "no", "RHEL: needs-restarting -r = 0");
eq(rebootPending(["kernel 6.6.1", "mod 6.6.1", "mod 6.6.0"]), { state: "no", kernel: "6.6.1" }, "el núcleo en marcha está instalado");
eq(rebootPending(["kernel 6.6.0", "mod 6.6.1"]).state, "kernel-gone", "Arch/Alpine: el núcleo en marcha ya no está");
eq(rebootPending(["kernel 7.2.15-300.fc45.x86_64"]).state, "unknown", "contenedor: sin /lib/modules");
eq(rebootPending([]), { state: "unknown", kernel: null }, "nada");
eq(rebootPending(["nr 124", "kernel 6.6.1", "mod 6.6.1"]).state, "no", "needs-restarting agotó el tiempo: se mira el núcleo");
eq(rebootPending(["nr 124", "kernel 6.6.1"]).state, "unknown", "agotó el tiempo y sin módulos: no se sabe");

// ── Comandos ──
const cmd = rebootCommand("sudo");
eq(cmd.startsWith("sudo sh -c '") && cmd.endsWith("'"), true, "sudo sh -c '…'");
eq(cmd.slice(12, -1).includes("'"), false, "sin comillas simples dentro");
eq(["systemctl reboot", "shutdown -r now", "c=reboot", "nohup", "&"].every((s) => cmd.includes(s)), true, "systemctl / shutdown / reboot, en segundo plano");
eq(rebootCommand("").startsWith("sh -c '"), true, "root: sin sudo");
eq(rebootCommand("doas").startsWith("doas sh -c '"), true, "doas");
eq(rebootSent("@@sent\n"), true, "orden aceptada");
eq([statusScript(false).includes("@@reboot"), statusScript(true).includes("needs-restarting")], [false, true], "lectura rápida antes, completa después");
eq(rebootSent(""), false, "sin la marca");

const info = (o: Partial<PrivilegeInfo>): PrivilegeInfo =>
  ({ level: "user", user: "ana", hasSudo: false, hasDoas: false, tool: null, error: null, ...o }) as PrivilegeInfo;
eq(rebootAccess(info({ level: "root" })), { tool: "", why: null }, "root");
eq(rebootAccess(info({ level: "sudo-nopasswd", tool: "doas", hasDoas: true })).tool, "doas", "doas sin contraseña");
eq(rebootAccess(info({ level: "sudo", tool: "sudo", hasSudo: true })).tool, "sudo", "sudo con contraseña");
eq(rebootAccess(info({ level: "maybe-sudo", tool: "sudo", hasSudo: true })).tool, "sudo", "puede que sudo");
eq(rebootAccess(info({ level: "unknown" })).tool, "sudo", "sin comprobar: se intenta con sudo");
eq(rebootAccess(info({ level: "sudo", tool: "doas", hasDoas: true })).tool, null, "doas con contraseña: no");
eq(rebootAccess(info({ level: "user" })).tool, null, "usuario normal: no");
eq(rebootAccess(null).tool, null, "sin detección todavía");

const out = "@@boot\nabc-123\n@@up\n4242.17 9000.1\n@@reboot\nkernel 6.8.0-49\nmod 6.8.0-49\n@@end\n";
const st = parseStatus(out);
eq(st, { bootId: "abc-123", uptimeSecs: 4242, pending: { state: "no", kernel: "6.8.0-49" } }, "lectura del estado");
eq(parseStatus("@@boot\n@@up\n@@reboot\n@@end\n"), { bootId: null, uptimeSecs: null, pending: { state: "unknown", kernel: null } }, "sin datos");

const status = (bootId: string | null, uptimeSecs: number | null = null): ServerStatus => ({ bootId, uptimeSecs, pending: { state: "no", kernel: "6.8.0-49" } });
eq(rebootedBetween(status("a"), status("b")), true, "boot_id distinto");
eq(rebootedBetween(status("a"), status("a")), false, "mismo boot_id");
eq(rebootedBetween(status(null, 5000), status(null, 40)), true, "sin boot_id: el tiempo encendido bajó");
eq(rebootedBetween(null, status("b")), null, "sin lectura previa: no se sabe");

// ── Progreso ──
const T0 = 1_000_000;
const start = (before: ServerStatus | null = status("a")) =>
  newRun({ key: "vps.example.com:22", serverName: "web", profileId: "p1", sessionId: "s1", reconnectCount: 0, before }, T0);
const tab = (status: "connected" | "reconnecting" | "closed" | "gone", reconnectCount = 0, reason: string | null = null): RebootEvent => ({ type: "tab", status, reconnectCount, reason });
const run = (evs: [RebootEvent, number][], r: RebootRun = start()) => evs.reduce((acc, [e, t]) => rebootStep(acc, e, t), r);

let r = start();
eq([r.phase, isActive(r.phase), stepStates(r)], ["sending", true, ["current", "todo", "todo"]], "empieza enviando");
eq(rebootStep(r, tab("connected"), T0 + 1), r, "en «sending» una pestaña conectada no cambia nada");

r = run([[{ type: "sent" }, T0 + 1000], [tab("reconnecting"), T0 + 3000]]);
eq([r.phase, r.downAt, stepStates(r)], ["waiting", T0 + 3000, ["done", "current", "todo"]], "se cayó: esperando");
eq(rebootStep(r, tab("reconnecting"), T0 + 9000), r, "más avisos de reconexión no cambian nada");
r = run([[tab("connected", 1), T0 + 60_000]], r);
eq([r.phase, r.backAt, stepStates(r)], ["checking", T0 + 60_000, ["done", "done", "current"]], "volvió: comprobando");
const after = { ...status("b"), pending: { state: "no" as const, kernel: "6.8.0-49" } };
r = rebootStep(r, { type: "checked", status: after }, T0 + 61_000);
eq([r.phase, stillPending(r), stepStates(r)], ["done", false, ["done", "done", "done"]], "reiniciado");
eq(phaseDetail(r), "Kernel en uso: 6.8.0-49. Ya no hace falta reiniciar.", "texto del resultado");
eq(rebootStep(r, { type: "stop" }, T0 + 62_000), r, "terminado: «Dejar de esperar» no hace nada");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1], [tab("connected", 1), T0 + 2]]);
r = rebootStep(r, { type: "checked", status: { ...status("b"), pending: { state: "required", kernel: "6.8.0-45" } } }, T0 + 3);
eq([r.phase, stillPending(r)], ["done", true], "reiniciado, pero aún pide reiniciar");
eq(resultText(r.after), "Kernel en uso: 6.8.0-45. El servidor sigue pidiendo reiniciar.", "aviso de que aún falta");

r = run([[{ type: "sent" }, T0], [tab("connected", 1), T0 + 50_000]]);
eq(r.phase, "checking", "la caída no se vio, pero la pestaña ya se reconectó");

r = run([[tab("reconnecting"), T0 + 500], [{ type: "sent" }, T0 + 800]]);
eq(r.phase, "waiting", "se cayó antes de que respondiera la orden");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1], [tab("connected", 1), T0 + 2], [{ type: "checked", status: status("a") }, T0 + 3]]);
eq([r.phase, r.message, stepStates(r)], ["failed", "La conexión se cortó, pero el servidor no se reinició.", ["done", "done", "error"]], "mismo arranque: no se reinició");

r = run([[{ type: "send-failed", message: "Contraseña incorrecta" }, T0 + 10]]);
eq([r.phase, r.message, r.canReconnect], ["failed", "Contraseña incorrecta", false], "la orden falló");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1], [tab("closed", 0, "se necesita la contraseña"), T0 + 5]]);
eq([r.phase, r.canReconnect, r.message], ["failed", true, "Se perdió la conexión: se necesita la contraseña"], "la reconexión se rindió");
r = rebootStep(r, { type: "reconnected-by-hand", sessionId: "s2" }, T0 + 99);
eq([r.phase, r.sessionId, r.canReconnect], ["checking", "s2", false], "reconectada a mano: se comprueba con la nueva");

r = run([[{ type: "sent" }, T0], [tab("gone"), T0 + 5]]);
eq([r.phase, r.canReconnect], ["failed", true], "se cerró la pestaña");

r = run([[{ type: "sent" }, T0], [{ type: "tick" }, T0 + DOWN_LIMIT_MS - 1]]);
eq(r.phase, "going-down", "aún dentro del plazo para apagarse");
r = rebootStep(r, { type: "tick" }, T0 + DOWN_LIMIT_MS + 1);
eq([r.phase, r.canReconnect], ["failed", false], "nunca se cortó: no se reinició");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1000], [{ type: "tick" }, T0 + 1000 + BACK_LIMIT_MS + 1]]);
eq([r.phase, r.canReconnect, r.message], ["failed", true, "El servidor no volvió en 5 minutos."], "no volvió a tiempo");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1], [{ type: "stop" }, T0 + 2]]);
eq([r.phase, isActive(r.phase), stepStates(r)], ["stopped", false, ["done", "error", "todo"]], "dejar de esperar");

r = run([[{ type: "sent" }, T0], [tab("reconnecting"), T0 + 1], [tab("connected", 1), T0 + 2], [{ type: "check-failed", message: "tiempo agotado" }, T0 + 3]]);
eq([r.phase, r.message], ["done", "Volvió, pero no se pudo comprobar su estado: tiempo agotado"], "volvió sin poder comprobar");

eq([formatElapsed(0), formatElapsed(42_900), formatElapsed(65_000), formatElapsed(725_000)], ["0:00", "0:42", "1:05", "12:05"], "tiempo transcurrido");
eq(serverKey({ host: " VPS.Example.com ", port: 0 }), "vps.example.com:22", "clave del servidor");

console.log(`reboot: ${passed} comprobaciones correctas`);
