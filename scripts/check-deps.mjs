// Busca dependencias circulares entre carpetas de la interfaz y falla si aparece una nueva.
//
//   npm run check:deps
//
// Cada carpeta es un nodo: `src/<área>/<dominio>` (p. ej. `features/connect`, `components/ui`) o
// `src/<área>` para los archivos sueltos de un área (`stores`, `lib`, `api`). Hay ciclo cuando una
// carpeta A importa de B y B (directa o indirectamente) de A. Cuentan todos los imports de los .ts/.tsx
// de producción: normales, `import type`, `export … from` e `import()` diferidos (las pruebas no).
//
// Los ciclos que ya existían están en `scripts/deps-allowlist.json`: ahí se anotan los imports
// concretos (archivo → archivo) que los cierran, con su motivo. Esa lista solo puede encoger.
// Además avisa si una excepción de límites de `eslint.config.js` ya no corresponde a ningún import.
// Solo usa el compilador de TypeScript para leer los imports: funciona sin red y en cualquier sistema.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { EXCEPCIONES_LIMITES } from "../eslint.config.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST = "scripts/deps-allowlist.json";
const enCi = !!process.env.GITHUB_ACTIONS;
const rel = (abs) => relative(root, abs).split(sep).join("/");

// ── Archivos e imports ─────────────────────────────────────────────────────────────────────────────
const todos = new Set(
  readdirSync(join(root, "src"), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => rel(join(d.parentPath, d.name))),
);
const esCodigo = (f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts");
const esPrueba = (f) => /\.test\.tsx?$/.test(f);

/** Ruta del archivo al que apunta un import relativo (o null si es un paquete o no existe). */
function resolver(desde, spec) {
  if (!spec.startsWith(".")) return null;
  const base = rel(resolve(root, dirname(desde), spec.split("?")[0]));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => todos.has(c)) ?? null;
}

/** Imports de cada archivo de código: archivo → archivos de src/ que importa. */
const imports = new Map();
for (const f of [...todos].filter(esCodigo)) {
  const info = ts.preProcessFile(readFileSync(join(root, f), "utf8"), true, true);
  const destinos = [];
  for (const { fileName } of info.importedFiles) {
    const a = resolver(f, fileName);
    if (a) destinos.push(a);
  }
  imports.set(f, destinos);
}

/** Carpeta (nodo del grafo) de un archivo de src/. */
function carpetaDe(f) {
  const partes = f.split("/").slice(1); // sin «src»
  if (partes.length === 1) return "(raíz de src)";
  if (partes.length === 2) return partes[0];
  return `${partes[0]}/${partes[1]}`;
}

// ── Excepciones anotadas ───────────────────────────────────────────────────────────────────────────
const allowlist = JSON.parse(readFileSync(join(root, ALLOWLIST), "utf8"));
const permitidos = new Map(); // "a.ts -> b.ts" → ciclo al que pertenece
for (const c of allowlist.ciclos) for (const imp of c.imports) permitidos.set(imp.replace(/\s+/g, " ").trim(), c.ciclo);
const clave = (de, a) => `${de} -> ${a}`;

// ── Grafo entre carpetas ───────────────────────────────────────────────────────────────────────────
/** carpeta → carpeta → [imports archivo→archivo], sin los imports `quitados`, las pruebas ni los de
 *  dentro de una misma carpeta. */
function grafo(quitados) {
  const g = new Map();
  for (const [de, destinos] of imports) {
    if (esPrueba(de)) continue;
    for (const a of destinos) {
      if (!esCodigo(a) || esPrueba(a)) continue;
      const [cd, ca] = [carpetaDe(de), carpetaDe(a)];
      if (cd === ca || quitados.has(clave(de, a))) continue;
      if (!g.has(cd)) g.set(cd, new Map());
      const ejemplos = g.get(cd).get(ca) ?? [];
      ejemplos.push(clave(de, a));
      g.get(cd).set(ca, ejemplos);
    }
  }
  return g;
}

/** Componentes fuertemente conexos (Tarjan) con más de una carpeta: cada uno contiene ciclos. */
function ciclos(g) {
  const nodos = new Set([...g.keys(), ...[...g.values()].flatMap((m) => [...m.keys()])]);
  const indice = new Map();
  const bajo = new Map();
  const pila = [];
  const enPila = new Set();
  const grupos = [];
  let n = 0;
  const visitar = (v) => {
    indice.set(v, n);
    bajo.set(v, n++);
    pila.push(v);
    enPila.add(v);
    for (const w of g.get(v)?.keys() ?? []) {
      if (!indice.has(w)) {
        visitar(w);
        bajo.set(v, Math.min(bajo.get(v), bajo.get(w)));
      } else if (enPila.has(w)) bajo.set(v, Math.min(bajo.get(v), indice.get(w)));
    }
    if (bajo.get(v) === indice.get(v)) {
      const grupo = [];
      let w;
      do {
        w = pila.pop();
        enPila.delete(w);
        grupo.push(w);
      } while (w !== v);
      if (grupo.length > 1) grupos.push(grupo.sort());
    }
  };
  for (const v of [...nodos].sort()) if (!indice.has(v)) visitar(v);
  return grupos;
}

// ── Comprobación ───────────────────────────────────────────────────────────────────────────────────
const avisos = [];
const quitados = new Set(permitidos.keys());
const g = grafo(quitados);
const nuevos = ciclos(g);

// Excepciones que sobran: el import ya no existe, o volver a contarlo no forma ningún ciclo.
for (const [imp, ciclo] of permitidos) {
  const [de, a] = imp.split(" -> ");
  if (!(imports.get(de) ?? []).includes(a)) {
    avisos.push(`${ALLOWLIST} («${ciclo}»): ya no existe ${imp}; borra la línea.`);
  } else if (nuevos.length === 0 && ciclos(grafo(new Set([...quitados].filter((q) => q !== imp)))).length === 0) {
    avisos.push(`${ALLOWLIST} («${ciclo}»): ${imp} ya no cierra ningún ciclo; borra la línea.`);
  }
}
for (const e of EXCEPCIONES_LIMITES) {
  for (const destino of e.importa) {
    const ruta = `src/${destino}`;
    const usado = (imports.get(e.archivo) ?? []).some((d) => d === ruta || d.startsWith(`${ruta}.`) || d.startsWith(`${ruta}/index.`));
    if (!usado) avisos.push(`eslint.config.js (EXCEPCIONES_LIMITES): ${e.archivo} ya no importa ${destino}; borra la excepción.`);
  }
}

for (const a of avisos) console.log(enCi ? `::warning::${a}` : `aviso: ${a}`);

/** Los ciclos más cortos dentro de un grupo (uno por cada import entre carpetas, sin repetir). */
function ciclosCortos(grupo, max) {
  const dentro = new Set(grupo);
  const vistos = new Map();
  for (const u of grupo) {
    for (const v of g.get(u)?.keys() ?? []) {
      if (!dentro.has(v)) continue;
      // Camino más corto de v a u (BFS): con u → v forma un ciclo.
      const previo = new Map([[v, null]]);
      const cola = [v];
      while (cola.length && !previo.has(u)) {
        const x = cola.shift();
        for (const y of g.get(x)?.keys() ?? []) if (dentro.has(y) && !previo.has(y)) previo.set(y, x), cola.push(y);
      }
      const camino = [];
      for (let x = u; x !== null; x = previo.get(x)) camino.unshift(x);
      const ciclo = [u, ...camino.slice(0, -1)];
      const i = ciclo.indexOf([...ciclo].sort()[0]);
      const norm = [...ciclo.slice(i), ...ciclo.slice(0, i)];
      vistos.set(norm.join(" "), norm);
    }
  }
  return [...vistos.values()].sort((a, b) => a.length - b.length).slice(0, max);
}

if (nuevos.length > 0) {
  console.log(`\n${nuevos.length === 1 ? "Hay un ciclo nuevo" : `Hay ${nuevos.length} grupos de ciclos nuevos`} entre carpetas de src/.`);
  for (const grupo of nuevos) {
    console.log(`\n  Carpetas en ciclo (${grupo.length}): ${grupo.join(" · ")}`);
    console.log("  Los más cortos (seguramente pasan por el import nuevo):");
    for (const ciclo of ciclosCortos(grupo, 5)) {
      console.log(`\n    ${[...ciclo, ciclo[0]].join(" → ")}`);
      for (const [i, de] of ciclo.entries()) {
        const ejemplos = g.get(de).get(ciclo[(i + 1) % ciclo.length]);
        console.log(`        ${ejemplos[0]}${ejemplos.length > 1 ? `  (y ${ejemplos.length - 1} más)` : ""}`);
      }
    }
  }
  console.log(
    "\nRómpelo moviendo el código a la carpeta que le toca (docs/ARQUITECTURA.md §5): lo que usan dos" +
      "\ndominios va a components/ui, lib/ o stores/. No se añaden excepciones nuevas a " + ALLOWLIST + ".",
  );
  if (enCi) console.log(`::error::Ciclo nuevo entre carpetas de src/ (npm run check:deps)`);
  process.exit(1);
}

const archivosProd = [...imports.keys()].filter((f) => !esPrueba(f)).length;
console.log(
  `Sin ciclos nuevos entre carpetas (${archivosProd} archivos; quedan ${allowlist.ciclos.length} ciclos antiguos` +
    ` con ${permitidos.size} imports anotados en ${ALLOWLIST}).`,
);
