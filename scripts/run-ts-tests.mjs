// Ejecuta todas las pruebas de la interfaz (`src/**/*.test.ts`): cada archivo se empaqueta con
// rolldown para Node y se ejecuta aparte. Una prueba falla si lanza un error (sale con código ≠ 0).
//
//   npm test                 → todas
//   npm test -- sidebar      → solo las que tengan «sidebar» en la ruta
//
// Funciona igual en Linux, macOS y Windows. Los archivos intermedios van a una carpeta temporal
// del sistema (nunca dentro de src/) y se borran al terminar.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const filter = process.argv.slice(2).map((f) => f.toLowerCase());

const tests = readdirSync(src, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith(".test.ts"))
  .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join("/"))
  .filter((t) => filter.length === 0 || filter.some((f) => t.toLowerCase().includes(f)))
  .sort();

if (tests.length === 0) {
  console.error("No hay pruebas que ejecutar.");
  process.exit(1);
}

/** Avisos del empaquetado: se oculta el «"use client"» de lucide-react (no aplica fuera de React). */
function onLog(level, log, handler) {
  if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
  handler(level, log);
}

const out = mkdtempSync(join(tmpdir(), "sshorus-tests-"));
const failed = [];
const started = Date.now();

try {
  for (const [i, test] of tests.entries()) {
    const file = join(out, `t${i}.mjs`);
    let res;
    try {
      await build({ input: join(root, test), platform: "node", onLog, output: { file, format: "esm" } });
      res = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8" });
    } catch (e) {
      res = { status: 1, stdout: "", stderr: `No se pudo empaquetar: ${e?.message ?? e}` };
    }
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
    if (res.status === 0 && !res.error) {
      const last = output.split("\n").pop() ?? "";
      console.log(`  ok    ${test}${last ? `  (${last})` : ""}`);
    } else {
      failed.push(test);
      console.log(`  FALLO ${test}`);
      if (res.error) console.log(`        ${res.error.message}`);
      if (output) console.log(output.replace(/^/gm, "        "));
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length > 0) {
  console.log(`\n${failed.length} de ${tests.length} pruebas fallaron (${secs} s):`);
  for (const f of failed) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n${tests.length} pruebas correctas (${secs} s).`);
