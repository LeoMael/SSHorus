// Pruebas de la lectura de Administración (READ_SCRIPT) con lo que dio la batería por distro
// (`npm run test:distros`, 26/11/2026). Ejecutar: npm test -- readScript
//
// Fallo encontrado: en Debian (y Alpine, Rocky, Alma, openSUSE) useradd/chpasswd están en /usr/sbin, que no está
// en el PATH de un usuario normal por SSH. La lectura no los veía y se elegían los comandos de busybox
// (adduser -D…) en un Debian.
import { detectEnv } from "./commands";
import { parseRead, READ_SCRIPT } from "./parse";

declare const process: { exit(code: number): never };
const nodeModule = (name: string) => import(/* @vite-ignore */ name);

let passed = 0;
function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
  passed++;
}

// Sección @@tools de Debian 12 por SSH (PATH /usr/local/bin:/usr/bin:/bin:/usr/games) antes y después del arreglo.
const DEBIAN_BEFORE = "@@me\ntester\n@@passwd\nroot:x:0:0:root:/root:/bin/bash\n@@group\nsudo:x:27:tester\n@@tools\ngpasswd\nchage\npasswd\npkill\nsudo\npkill-procps\n@@end\n";
const DEBIAN_AFTER = DEBIAN_BEFORE.replace("@@tools\n", "@@tools\nuseradd\nusermod\nuserdel\ngroupadd\ngroupdel\ngroupmod\nchpasswd\n");

const before = parseRead(DEBIAN_BEFORE);
ok(detectEnv(before.tools, "debian", [], ["sudo"]).toolset === "busybox", "sin /usr/sbin, Debian parecía busybox (el fallo)");
const after = parseRead(DEBIAN_AFTER);
const env = detectEnv(after.tools, "debian", [], ["sudo"]);
ok(env.toolset === "shadow" && env.adminGroup === "sudo" && env.canUsermod, "con /usr/sbin, Debian usa shadow-utils y el grupo sudo");

// El script añade /usr/sbin y /sbin al PATH antes de buscar las herramientas.
ok(READ_SCRIPT.startsWith("PATH=$PATH:/usr/sbin:/sbin"), "READ_SCRIPT amplía el PATH");

// Ejecutado de verdad con el PATH corto de Debian: si este equipo tiene useradd solo en /usr/sbin (Debian/Ubuntu,
// como la CI), tiene que encontrarlo.
const { execFileSync } = await nodeModule("node:child_process");
const { existsSync } = await nodeModule("node:fs");
const out: string = execFileSync("/bin/sh", ["-c", READ_SCRIPT], {
  encoding: "utf8",
  env: { PATH: "/usr/local/bin:/usr/bin:/bin:/usr/games", LC_ALL: "C" },
});
const real = parseRead(out);
ok(real.passwd.length > 0, "la lectura local devuelve /etc/passwd");
if (existsSync("/usr/sbin/useradd") && !existsSync("/usr/bin/useradd")) {
  ok(real.tools.has("useradd"), "con el PATH de Debian encuentra /usr/sbin/useradd");
}

console.log(`readScript.test.ts: ${passed} comprobaciones`);
if (passed === 0) process.exit(1);
