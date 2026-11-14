// Pruebas de la navegación dentro de un servidor y del aviso al cerrar (funciones puras).
// Ejecutar: npx rolldown src/components/Session/sessionNav.test.ts -p node -f esm -o /tmp/nav.mjs && node /tmp/nav.mjs
import { closeTarget, currentSection, fileStep, sectionItems, stepItem } from "./sessionNav";
import { closeWarning } from "./closeConfirm";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const FIXED = ["files", "commands", "admin"];
const FILES = ["/a.txt", "/b.txt"];

// Avanzar y retroceder dando la vuelta
eq(stepItem(FIXED, "files", 1), "commands", "siguiente");
eq(stepItem(FIXED, "admin", 1), "files", "da la vuelta al final");
eq(stepItem(FIXED, "files", -1), "admin", "da la vuelta al principio");
eq(stepItem(FIXED, "otra", 1), "files", "sin actual: el primero");
eq(stepItem(FIXED, null, -1), "admin", "sin actual hacia atrás: el último");
eq(stepItem([], "x", 1), null, "lista vacía");

// Secciones: la fila entera; al dividir, solo las vistas fijas
eq(sectionItems(FIXED, FILES, "side"), [...FIXED, ...FILES], "fila entera");
eq(sectionItems(FIXED, FILES, "split"), FIXED, "dividido: solo vistas fijas");
eq(currentSection("editors", "files", "/b.txt"), "/b.txt", "se ve un archivo");
eq(currentSection("side", "commands", "/b.txt"), "commands", "se ve una vista fija");
eq(currentSection("split", "commands", "/b.txt"), "commands", "dividido: la vista fija");
eq(stepItem(sectionItems(FIXED, FILES, "editors"), "/b.txt", 1), "files", "del último archivo a Archivos");
eq(stepItem(sectionItems(FIXED, FILES, "side"), "admin", 1), "/a.txt", "de la última vista al primer archivo");

// Archivos
eq(fileStep(FILES, "/a.txt", "editors", 1), "/b.txt", "archivo siguiente");
eq(fileStep(FILES, "/a.txt", "split", -1), "/b.txt", "archivo anterior da la vuelta");
eq(fileStep(FILES, "/b.txt", "side", 1), "/b.txt", "desde una vista fija vuelve al último archivo");
eq(fileStep([], null, "side", 1), null, "sin archivos");

// Ctrl+W: solo el archivo que se ve y tiene el foco
eq(closeTarget("editors", "/a.txt", "editors"), "/a.txt", "archivo a la vista");
eq(closeTarget("editors", "/a.txt", "other"), "/a.txt", "foco en la fila de pestañas");
eq(closeTarget("side", "/a.txt", "side"), null, "vista fija: no se cierra nada");
eq(closeTarget("split", "/a.txt", "side"), null, "dividido con foco en la vista fija");
eq(closeTarget("split", "/a.txt", "editors"), "/a.txt", "dividido con foco en el editor");
eq(closeTarget("editors", "/a.txt", "terminal"), null, "la terminal es de la shell");
eq(closeTarget("editors", null, "editors"), null, "sin archivo");

// Aviso al cerrar la conexión
eq(closeWarning("web", [], 0), null, "nada pendiente: sin pregunta");
eq(closeWarning("web", ["a.txt"], 0)?.title, "Cambios sin guardar", "solo cambios");
eq(closeWarning("web", ["a.txt"], 0)?.message, "«a.txt» tiene cambios sin guardar en «web». ¿Cerrar la conexión y descartarlos?", "texto de un archivo");
eq(closeWarning("web", [], 1)?.message, "En «web» hay una transferencia sin terminar. Si cierras la conexión, se cortan. ¿Cerrarla igualmente?", "una transferencia");
eq(closeWarning("web", [], 3)?.title, "Transferencias en curso", "solo transferencias");
eq(closeWarning("web", ["a", "b", "c", "d", "e"], 2)?.message, "En «web» 5 archivos tienen cambios sin guardar (a, b, c, d…) y hay 2 transferencias sin terminar. Al cerrar se pierden los cambios y se cortan las transferencias.", "ambas cosas");

console.log(`sessionNav: ${passed} comprobaciones OK`);
