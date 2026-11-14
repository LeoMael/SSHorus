// Pruebas del estado de las cuentas («Solo llave» frente a «Bloqueada») y su lectura como root.
// Ejecutar: npx rolldown src/features/admin/accounts.test.ts -p node -f esm -o /tmp/acc.mjs && node /tmp/acc.mjs
import { accountState, ACCOUNTS_SCRIPT, KEY_ONLY_SUDO_WARNING, parseAccountsOutput, todayDays } from "./accounts";
import type { ShadowEntry, ShadowStatus, SudoAccess } from "./parse";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

const TODAY = 20000;
function sh(status: ShadowStatus, keys: number | null, extra: Partial<ShadowEntry> = {}, sudo: SudoAccess | null = null): ShadowEntry {
  return { name: "u", status, lastChange: 19000, maxDays: null, expireDays: null, keys, sudo, ...extra };
}
const kind = (shell: string, s: ShadowEntry | null) => accountState({ shell, shadow: s }, TODAY).kind;

// ── Script: nunca saca hashes; termina en @@end ──
ok(!/print \$2/.test(ACCOUNTS_SCRIPT), "no imprime el campo del hash");
ok(ACCOUNTS_SCRIPT.startsWith("echo @@keys") && ACCOUNTS_SCRIPT.trimEnd().endsWith("echo @@end"), "secciones");
ok(ACCOUNTS_SCRIPT.includes("NOPASSWD: ALL"), "distingue sudo sin contraseña");

// ── Lectura ──
const read = parseAccountsOutput(
  ["@@keys", "tesis:1:1", "leo:0:2", "raro:?:x", "fantasma:3:1", "@@shadow", "tesis:L:20000::", "leo:P:20000::", "raro:NL:20000::", "@@end"].join("\n"),
);
eq([read.get("tesis")?.keys, read.get("tesis")?.sudo], [1, "password"], "tesis: 1 llave, sudo con contraseña");
eq([read.get("leo")?.keys, read.get("leo")?.sudo], [0, "nopasswd"], "leo: sudo sin contraseña");
eq([read.get("raro")?.keys, read.get("raro")?.sudo], [null, null], "valores raros = no se sabe");
eq(read.has("fantasma"), false, "sin entrada en shadow no se inventa");
let threw = false;
try {
  parseAccountsOutput("@@keys\ntesis:1:1");
} catch {
  threw = true;
}
ok(threw, "sin @@end falla");

// ── El caso del usuario: creado con «Nuevo usuario con clave» (contraseña «!» o «*») y con su llave ──
for (const st of ["L", "NL"] as const) {
  const s = accountState({ shell: "/bin/bash", shadow: sh(st, 1, {}, "password") }, TODAY);
  eq(s.kind, "key-only", `${st} con llave = Solo llave`);
  eq(s.title, "La contraseña está desactivada; entra con su llave SSH", "explicación");
  eq(s.sudoWarning, KEY_ONLY_SUDO_WARNING, "sudo con contraseña: aviso");
}
eq(accountState({ shell: "/bin/bash", shadow: sh("L", 2, {}, "nopasswd") }, TODAY).sudoWarning, null, "sudo sin contraseña: sin aviso");
eq(accountState({ shell: "/bin/bash", shadow: sh("L", 2, {}, "none") }, TODAY).sudoWarning, null, "sin sudo: sin aviso");

// ── Bloqueada de verdad ──
eq(kind("/bin/bash", sh("L", 0)), "locked", "bloqueada y sin llaves");
eq(kind("/bin/bash", sh("NL", 0)), "locked", "sin contraseña ni llaves");
eq(kind("/bin/bash", sh("L", null)), "locked", "bloqueada y sin poder leer las llaves");
eq(kind("/usr/sbin/nologin", sh("L", 3)), "locked", "nologin, aunque tenga llaves");
eq(kind("/usr/sbin/nologin", sh("P", 0)), "locked", "nologin con contraseña");
const expired = accountState({ shell: "/bin/bash", shadow: sh("L", 3, { expireDays: TODAY }) }, TODAY);
ok(expired.kind === "locked" && expired.title.startsWith("La cuenta caducó"), "caducada (hoy) aunque tenga llaves");

// ── Resto de estados ──
eq(kind("/bin/bash", null), "unknown", "sin leer shadow");
eq(kind("/bin/bash", sh("P", 0)), "active", "activa");
eq(kind("/bin/bash", sh("P", 0, { lastChange: 0 })), "change", "debe cambiarla");
eq(kind("/bin/bash", sh("NP", 0)), "empty", "vacía");
ok(accountState({ shell: "/bin/bash", shadow: sh("P", 0, { expireDays: TODAY + 1 }) }, TODAY).title.startsWith("La cuenta caduca"), "caduca mañana");
eq(todayDays(Date.UTC(2026, 0, 1, 12)), 20454, "días desde 1970");

console.log(`accounts: ${passed} comprobaciones correctas`);
