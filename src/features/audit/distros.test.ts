// Fallos de la auditoría que encontró la batería por distro (`npm run test:distros`, 26/11/2026), con lo que
// devolvieron los contenedores. Ejecutar: npm test -- audit/distros
//  1. openSUSE: «Actualizaciones pendientes: Gestor de paquetes no reconocido» (no se leía zypper).
//  2. Con sudo y sin registro de entradas (contenedor, Alpine sin syslog): decía «necesita sudo».
//  3. «1 carpeta personal es visibles» (plural mal hecho).
import { runChecks } from "./checks";
import { AUDIT_SCRIPT } from "./script";

declare const process: { exit(code: number): never };
const nodeModule = (name: string) => import(/* @vite-ignore */ name);

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function audit(stdout: string, elevated = true) {
  const { checks } = runChecks({ stdout, elevated, ports: null, web: null, vuln: null, now: Date.parse("2026-11-26T12:00:00Z") });
  return new Map(checks.map((c) => [c.id, c]));
}

// Salida de openSUSE Leap 15.6 (como root), recortada a lo que importa aquí.
const SUSE = [
  "@@id",
  "0 root",
  "root",
  "@@os",
  "opensuse-leap|suse opensuse|openSUSE Leap 15.6",
  "@@updates",
  "zypper|3|1",
  "@@auth",
  "f2b none",
  "@@homes",
  "tester|/home/tester|755|tester|tester",
  "@@end",
].join("\n");

const c = audit(SUSE);
eq(c.get("updates.pending")?.status, "bad", "zypper: hay parches de seguridad");
eq(c.get("updates.pending")?.detail, "1 actualización de seguridad (3 en total)", "zypper: texto");
eq(c.get("updates.pending")?.fix?.command, "zypper -n refresh\nzypper -n patch --category security", "zypper: arreglo");
const upToDate = audit(SUSE.replace("zypper|3|1", "zypper|0|0"));
eq(upToDate.get("updates.pending")?.status, "ok", "zypper: al día");
eq(audit(SUSE.replace("zypper|3|1", "zypper|2|0")).get("updates.pending")?.fix?.command, "zypper -n refresh\nzypper -n update", "zypper: sin seguridad");
eq(audit(SUSE.replace("zypper|3|1", "zypper|?|0")).get("updates.pending")?.detail, "No se pudo leer (sin caché de paquetes)", "zypper: sin caché");

eq(c.get("logins.failed")?.detail, "No hay registro de entradas que leer (ni journald ni /var/log/auth.log, secure o messages)", "sin registro, con sudo");
eq(audit(SUSE.replace("0 root\nroot", "1000 tester\ntester"), false).get("logins.failed")?.detail, "Sin comprobar: necesita sudo", "sin registro, sin sudo");

eq(c.get("iso.homes")?.detail, "1 carpeta personal es visible para otros usuarios", "plural en singular");
eq(
  audit(SUSE.replace("@@homes\n", "@@homes\nana|/home/ana|755|ana|ana\n")).get("iso.homes")?.detail,
  "2 carpetas personales son visibles para otros usuarios",
  "plural",
);

// La parte de actualizaciones del script con un zypper falso (salidas --xmlout reales de Leap 15.6).
const { execFileSync } = await nodeModule("node:child_process");
const fs = await nodeModule("node:fs");
const os = await nodeModule("node:os");
const path = await nodeModule("node:path");
const lines = AUDIT_SCRIPT.split("\n");
const block = lines.slice(lines.indexOf("echo @@updates"), lines.findIndex((l) => l.startsWith("else echo 'none|?|?'")) + 1).join("\n");
const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), "sshorus-zypper-"));
try {
  // Solo grep y cat en el PATH: así no se cuelan el dnf o el apt de este equipo.
  for (const tool of ["grep", "cat"]) {
    const bin = [`/usr/bin/${tool}`, `/bin/${tool}`].find((g) => fs.existsSync(g));
    fs.symlinkSync(bin, path.join(dir, tool));
  }
  const fake = (updates: string, patches: string) =>
    fs.writeFileSync(
      path.join(dir, "zypper"),
      `#!/bin/sh\ncase "$*" in\n  *list-updates*) cat <<'X'\n${updates}\nX\n;;\n  *list-patches*) cat <<'X'\n${patches}\nX\n;;\nesac\n`,
      { mode: 0o755 },
    );
  const run = () => execFileSync("/bin/sh", ["-c", block], { encoding: "utf8", env: { PATH: dir } }).trim();
  const UPD = (items: string) => `<?xml version='1.0'?>\n<stream>\n<update-status version="0.6">\n<update-list>\n${items}</update-list>\n</update-status>\n</stream>`;
  const PKG = `<update name="openssl-3" edition="3.1.4-150600.5.21.1" arch="x86_64" kind="package">\n<summary>x</summary>\n</update>\n`;
  const SEC = `<update kind="patch" name="openSUSE-SLE-15.6-2026-1" edition="1" arch="noarch" status="needed" category="security" severity="important">\n</update>\n`;
  fake(UPD(""), UPD(""));
  eq(run(), "@@updates\nzypper|0|0", "zypper al día");
  fake(UPD(PKG + PKG.replace("openssl-3", "curl")), UPD(SEC));
  eq(run(), "@@updates\nzypper|2|1", "zypper con 2 paquetes y 1 parche de seguridad");
  fake("Repository 'x' is invalid.", "");
  eq(run(), "@@updates\nzypper|?|0", "zypper sin poder leer");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`audit/distros.test.ts: ${passed} comprobaciones`);
if (passed === 0) process.exit(1);
