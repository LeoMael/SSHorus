// Pruebas de funciones puras de privilegios: de dónde sale la contraseña de sudo y el envoltorio de sudo -S.
// Ejecutar: npx rolldown src/features/privileges/privileges.test.ts -p node -f esm -o /tmp/pt.mjs && node /tmp/pt.mjs
import { NOPASSWD_CHECK_COMMAND, parseNoPasswdCheck, parsePrivilegeOutput, withSudoNoPassword } from "./detect";
import { buildExec, elevationFailure, EXIT_SUDO_BAD_PASSWORD } from "./elevate";
import {
  defaultSaveChecked,
  otherSessionPasswords,
  resetStoredState,
  storedFailed,
  storedStateAfterConfirm,
  sudoLookupPlan,
  sudoPasswordNeeded,
  sudoSourceChanged,
  type SudoLookupInput,
} from "./lookup";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const base: SudoLookupInput = { hasMemory: false, stored: undefined, mode: "saved", otherSessions: 0 };

// ── Orden de búsqueda ──
eq(sudoLookupPlan({ ...base, hasMemory: true }), ["memory"], "en memoria: no se busca nada más");
eq(sudoLookupPlan({ ...base, hasMemory: true, stored: "off" }), ["memory"], "en memoria aunque se olvidara la guardada antes");
eq(sudoLookupPlan(base), ["stored", "ask"], "guardada sin leer: primero la guardada");
eq(sudoLookupPlan({ ...base, mode: "login" }), ["stored", "ask"], "«La de la conexión» también se lee");
eq(sudoLookupPlan({ ...base, stored: "loading" }), ["stored", "ask"], "leyéndose: se espera a esa lectura");
eq(sudoLookupPlan({ ...base, stored: "ok" }), ["stored", "ask"], "«ok» sin memoria (rechazada y olvidada): se vuelve a leer");
eq(sudoLookupPlan({ ...base, mode: "ask" }), ["ask"], "«Pedir cada vez»: se pregunta");
eq(sudoLookupPlan({ ...base, stored: "none" }), ["ask"], "no había guardada: no se relee");
eq(sudoLookupPlan({ ...base, stored: "failed" }), ["ask"], "la guardada falló: no se reintenta (sin bucle)");
eq(sudoLookupPlan({ ...base, stored: "rejected" }), ["ask"], "falló y ya se avisó: no se reintenta");
eq(sudoLookupPlan({ ...base, stored: "off", otherSessions: 2 }), ["ask"], "«Olvidar»: ni guardada ni otras pestañas");
eq(sudoLookupPlan({ ...base, otherSessions: 1 }), ["stored", "other-session", "ask"], "guardada, luego otra pestaña");
eq(sudoLookupPlan({ ...base, mode: "ask", otherSessions: 1 }), ["other-session", "ask"], "«Pedir cada vez» con otra pestaña");
eq(sudoLookupPlan({ ...base, stored: "failed", otherSessions: 1 }), ["other-session", "ask"], "guardada mala: otra pestaña");
eq(sudoLookupPlan({ ...base, stored: "retry" }), ["stored", "ask"], "error pasajero: se vuelve a mirar");

// ── Desde el diálogo (justo antes de preguntar) ──
const dlg: SudoLookupInput = { ...base, fromDialog: true };
eq(sudoLookupPlan({ ...dlg, stored: "none" }), ["stored", "ask"], "diálogo: relee aunque antes no hubiera guardada");
eq(sudoLookupPlan({ ...dlg, stored: "retry" }), ["stored", "ask"], "diálogo: reintenta tras un error pasajero");
eq(sudoLookupPlan({ ...dlg, stored: undefined }), ["stored", "ask"], "diálogo: sin mirar aún");
eq(sudoLookupPlan({ ...dlg, stored: "failed" }), ["ask"], "diálogo: sudo la rechazó, no se reintenta (bloqueo de cuenta)");
eq(sudoLookupPlan({ ...dlg, stored: "rejected" }), ["ask"], "diálogo: rechazada y avisada, no se reintenta");
eq(sudoLookupPlan({ ...dlg, stored: "off", otherSessions: 1 }), ["ask"], "diálogo: «Olvidar» se respeta");
eq(sudoLookupPlan({ ...dlg, stored: "none", mode: "ask" }), ["ask"], "diálogo con «Pedir cada vez»: no hay guardada que leer");
eq(sudoLookupPlan({ ...dlg, stored: "none", otherSessions: 1 }), ["stored", "other-session", "ask"], "diálogo: guardada y otra pestaña");

// ── Estado tras comprobar la guardada ──
eq(storedStateAfterConfirm({ ok: true }), "ok", "correcta");
eq(storedStateAfterConfirm({ ok: false, badPassword: true }), "failed", "incorrecta");
eq(storedStateAfterConfirm({ ok: false }), "none", "otro fallo (tty, sin permiso): no se marca como incorrecta");
eq(storedStateAfterConfirm({ ok: false, transient: true }), "retry", "sudo tardó o se cortó: se reintenta luego");
eq(storedStateAfterConfirm({ ok: false, badPassword: true, transient: true }), "failed", "incorrecta manda sobre pasajero");
ok(storedFailed("failed") && storedFailed("rejected"), "failed y rejected cuentan como fallida");
ok(!storedFailed("ok") && !storedFailed("none") && !storedFailed("retry") && !storedFailed(undefined) && !storedFailed("off"), "el resto no");

// ── Volver a mirar al guardar el servidor o desbloquear ──
ok(resetStoredState("none", false) && resetStoredState("retry", false), "sin guardada o error pasajero: siempre");
ok(!resetStoredState("failed", false) && !resetStoredState("rejected", false), "rechazada y nada cambió: no (sería otro intento fallido)");
ok(resetStoredState("failed", true) && resetStoredState("rejected", true), "rechazada pero cambió la contraseña o el modo: sí");
ok(!resetStoredState("off", true), "«Olvidar» se respeta hasta reconectar");
ok(!resetStoredState("loading", true) && !resetStoredState("ok", true) && !resetStoredState(undefined, true), "leyéndose, en memoria o sin mirar: nada");

const srv = { auth: "password" as const, sudoMode: "saved" as const };
ok(sudoSourceChanged(undefined, srv, {}), "servidor nuevo");
ok(sudoSourceChanged(srv, srv, { sudoSecret: "x" }), "contraseña de sudo nueva");
ok(sudoSourceChanged(srv, srv, { sudoSecret: "" }), "contraseña de sudo borrada");
ok(sudoSourceChanged(srv, { ...srv, sudoMode: "ask" }, {}), "cambió el modo");
ok(!sudoSourceChanged(srv, srv, { secret: "x" }), "«Guardar»: la de la conexión no influye");
ok(!sudoSourceChanged(srv, srv, {}), "otros cambios (nombre, color…): no");
ok(!sudoSourceChanged({ auth: "password" }, { auth: "password", sudoMode: "ask" }, {}), "sin modo = «Pedir cada vez»");
const login = { auth: "password" as const, sudoMode: "login" as const };
ok(sudoSourceChanged(login, login, { secret: "x" }), "«La de la conexión»: cambió la contraseña de la conexión");
ok(sudoSourceChanged({ ...login, auth: "key" }, login, {}), "«La de la conexión»: cambió el método de la conexión");

// ── «Guardar para este servidor» marcado de entrada ──
eq(defaultSaveChecked({ change: false, failed: false, mode: "ask" }), false, "pedir cada vez, sin fallo");
eq(defaultSaveChecked({ change: false, failed: false, mode: "saved" }), true, "ya guardaba");
eq(defaultSaveChecked({ change: false, failed: false, mode: "login" }), true, "usa la de la conexión");
eq(defaultSaveChecked({ change: false, failed: true, mode: "ask" }), true, "la guardada falló");
eq(defaultSaveChecked({ change: true, failed: false, mode: "ask" }), true, "«Cambiar contraseña de sudo…»");

// ── Otras pestañas del mismo servidor ──
const tabs = [
  { sessionId: "a", profileId: "srv1", status: "connected" },
  { sessionId: "b", profileId: "srv1", status: "connected" },
  { sessionId: "c", profileId: "srv1", status: "closed" },
  { sessionId: "d", profileId: "srv2", status: "connected" },
  { sessionId: "e", profileId: "srv1", status: "reconnecting" },
  { sessionId: "f", profileId: "srv1", status: "connected" },
];
const mem = { a: "yo", b: "uno", c: "cerrada", d: "otro-servidor", e: "uno" };
eq(otherSessionPasswords(tabs, mem, "a", "srv1"), ["uno"], "mismo servidor, sin repetir, sin la propia ni cerradas");
eq(otherSessionPasswords(tabs, mem, "f", "srv1"), ["yo", "uno"], "desde una pestaña sin contraseña");
eq(otherSessionPasswords(tabs, mem, "d", "srv2"), [], "otro servidor: nada (la clave es el perfil, no la pestaña)");
eq(otherSessionPasswords(tabs, {}, "a", "srv1"), [], "nadie la tiene");

// ── sudo -S: la contraseña va por stdin, nunca en el comando ──
const req = buildExec("id -u", { kind: "password", password: "s3cr'eto" });
ok(!req.command.includes("s3cr") && !req.script.includes("s3cr"), "ni en el comando ni en el script mostrado");
ok(req.stdin.endsWith("s3cr'eto\n"), "va por stdin, tras el script");
ok(req.script.includes("sudo -k -S -p '' -v"), "se comprueba con sudo -v antes de ejecutar");
eq(elevationFailure(EXIT_SUDO_BAD_PASSWORD, "__TV_SUDO_BAD__\n"), "bad-password", "contraseña incorrecta reconocida");
eq(elevationFailure(EXIT_SUDO_BAD_PASSWORD, "otra cosa"), null, "sin la marca no se confunde con el script");

// ── Comandos con sudo del asistente (MCP): ¿hace falta la contraseña? ──
eq(sudoPasswordNeeded({ level: "root", hasSudo: true }), false, "root: no");
eq(sudoPasswordNeeded({ level: "sudo-nopasswd", hasSudo: true }), false, "sudo sin contraseña: no");
eq(sudoPasswordNeeded({ level: "sudo", hasSudo: true }), true, "sudo con contraseña: sí");
eq(sudoPasswordNeeded({ level: "maybe-sudo", hasSudo: true }), true, "puede que tenga sudo: sí");
eq(sudoPasswordNeeded({ level: "user", hasSudo: true }), true, "fuera de wheel pero con sudo instalado: se intenta");
eq(sudoPasswordNeeded({ level: "user", hasSudo: false }), false, "sin sudo en el servidor: no");
eq(sudoPasswordNeeded({ level: "unknown", hasSudo: false }), true, "sin comprobar: se intenta");

// ── «Comprobar sudo sin contraseña» (bajo demanda) ──
ok(!/'/.test(NOPASSWD_CHECK_COMMAND.slice(7, -1)) && !NOPASSWD_CHECK_COMMAND.includes("!"), "sin comillas simples internas ni «!»");
ok(NOPASSWD_CHECK_COMMAND.includes("sudo -n true </dev/null"), "sudo -n: nunca pregunta");
eq(parseNoPasswdCheck("sudo_nopasswd=1\n"), true, "sin contraseña");
eq(parseNoPasswdCheck("sudo_nopasswd=0\n"), false, "pide contraseña");
eq(parseNoPasswdCheck(""), false, "sin salida: no");
const maybe = parsePrivilegeOutput("tv_begin=1\nuid=1000\nuser=ana\ngroups=ana\nsudo=1\ndoas=0\ntv_end=1\n", 1);
eq(maybe.level, "maybe-sudo", "fuera de wheel/sudo/admin: puede que tenga sudo (sin probar sudo -n)");
const up = withSudoNoPassword(maybe);
eq([up.level, up.tool, up.user], ["sudo-nopasswd", "sudo", "ana"], "tras comprobarlo: sudo sin contraseña");

console.log(`privileges: ${passed} comprobaciones correctas`);
