// Pruebas de las reglas del área de trabajo (funciones puras).
// Ejecutar: npx rolldown src/components/Session/workArea.test.ts -p node -f esm -o /tmp/wa.mjs && node /tmp/wa.mjs
import { currentFile, initialLayout, moveItem, neighborAfterClose, splitLayout, workMode } from "./workArea";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const FILES = ["/a", "/b", "/c", "/d"];
const none = new Set<string>();

// Archivo que se ve
eq(currentFile("/b", FILES, FILES, none), "/b", "el elegido");
eq(currentFile(null, FILES, FILES, none), "/a", "sin elegido: el primero");
eq(currentFile("/c", ["/a", "/d"], FILES, new Set(["/b", "/c"])), "/a", "se fue a otra ventana: el más cercano a la izquierda");
eq(currentFile("/a", ["/b"], FILES.slice(0, 2), new Set(["/a"])), "/b", "sin nada a la izquierda: el primero");
eq(currentFile("/a", [], ["/a"], new Set(["/a"])), null, "todos en otra ventana");

// Modo
eq(workMode(null, true, "file"), "side", "sin archivo: vista fija");
eq(workMode("/a", true, "fixed"), "split", "dividido");
eq(workMode("/a", false, "file"), "editors", "archivo");
eq(workMode("/a", false, "fixed"), "side", "vista fija");

// Cerrar
eq(neighborAfterClose(FILES, "/c"), "/b", "pasa al de la izquierda");
eq(neighborAfterClose(FILES, "/a"), "/b", "el primero pasa al siguiente");
eq(neighborAfterClose(["/a"], "/a"), null, "sin más archivos");

// Reordenar
eq(moveItem(FILES, "/a", "/c"), ["/b", "/c", "/a", "/d"], "hacia la derecha");
eq(moveItem(FILES, "/d", "/b"), ["/a", "/d", "/b", "/c"], "hacia la izquierda");
eq(moveItem(FILES, "/x", "/b"), FILES, "desconocido: igual");

// Reparto guardado
eq(initialLayout([60, 40]), { work: 60, terminal: 40 }, "terminal guardada");
eq(initialLayout([99, 1]), { work: 58, terminal: 42 }, "terminal plegada: la de siempre");
eq(initialLayout(undefined), { work: 58, terminal: 42 }, "sin guardar");
eq(splitLayout([30, 70]), { side: 30, editors: 70 }, "división guardada");
eq(splitLayout([95, 5]), { side: 38, editors: 62 }, "división fuera de rango");

console.log(`workArea: ${passed} comprobaciones OK`);
