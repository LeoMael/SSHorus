// Tope de 500 líneas por archivo de código (docs/dev/REGLAS-AGENTES.md §5).
//
//   npm run check:lines
//
// Mira los .ts, .tsx, .rs y .css de producción de src/ y src-tauri/src/ (sin pruebas: `*.test.ts`,
// `*tests*.rs` y carpetas `tests/`). Los archivos que ya pasaban del tope están en
// `scripts/lines-allowlist.json` con las líneas que tenían: falla si uno de ellos crece o si otro
// archivo pasa de 500. Esa lista solo puede encoger: cuando un archivo baja, avisa para actualizarla.
// Funciona igual en Linux, macOS y Windows.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TOPE = 500;
const CARPETAS = ["src", "src-tauri/src"];
const ALLOWLIST = "scripts/lines-allowlist.json";
const root = fileURLToPath(new URL("..", import.meta.url));
const enCi = !!process.env.GITHUB_ACTIONS;

const esCodigo = (f) => /\.(tsx?|rs|css)$/.test(f) && !f.endsWith(".d.ts");
const esPrueba = (f) => /\.test\.tsx?$/.test(f) || /(^|\/)[^/]*tests[^/]*\.rs$/.test(f) || /(^|\/)tests\//.test(f);

/** Líneas como las cuenta un editor (igual que `wc -l` si el archivo acaba en salto de línea). */
function lineas(texto) {
  if (texto.length === 0) return 0;
  return texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
}

const medidos = new Map();
for (const carpeta of CARPETAS) {
  for (const d of readdirSync(join(root, carpeta), { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const f = relative(root, join(d.parentPath, d.name)).split(sep).join("/");
    if (esCodigo(f) && !esPrueba(f)) medidos.set(f, lineas(readFileSync(join(root, f), "utf8")));
  }
}

const allowlist = JSON.parse(readFileSync(join(root, ALLOWLIST), "utf8"));
const permitido = allowlist.archivos;

const errores = [];
const avisos = [];
for (const [f, n] of [...medidos].sort()) {
  const max = permitido[f];
  if (max === undefined) {
    if (n > TOPE) errores.push(`${f}: ${n} líneas (el tope es ${TOPE}).`);
  } else if (n > max) {
    errores.push(`${f}: ${n} líneas; estaba en ${max} en ${ALLOWLIST} y no puede crecer.`);
  } else if (n <= TOPE) {
    avisos.push(`${f} ya tiene ${n} líneas (≤ ${TOPE}): bórralo de ${ALLOWLIST}.`);
  } else if (n < max) {
    avisos.push(`${f} bajó de ${max} a ${n} líneas: pon ${n} en ${ALLOWLIST}.`);
  }
}
for (const f of Object.keys(permitido)) {
  if (!medidos.has(f)) avisos.push(`${f} ya no existe (o es una prueba): bórralo de ${ALLOWLIST}.`);
}

for (const a of avisos) console.log(enCi ? `::warning::${a}` : `aviso: ${a}`);

if (errores.length > 0) {
  console.log(`\n${errores.length === 1 ? "Un archivo pasa" : `${errores.length} archivos pasan`} del tope de líneas:`);
  for (const e of errores) console.log(`  ${e}`);
  console.log(
    "\nPártelo en archivos con un solo tema (componente, hook o módulo nuevo; en Rust, submódulos)." +
      `\nNo se añaden archivos nuevos a ${ALLOWLIST}.`,
  );
  if (enCi) console.log(`::error::Archivos de más de ${TOPE} líneas (npm run check:lines)`);
  process.exit(1);
}

const quedan = Object.keys(permitido).length;
console.log(`Ningún archivo nuevo pasa de ${TOPE} líneas (${medidos.size} archivos; quedan ${quedan} en ${ALLOWLIST}).`);
