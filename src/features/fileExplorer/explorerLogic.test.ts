// Pruebas de las reglas del explorador (funciones puras).
// Ejecutar: npx rolldown src/features/fileExplorer/explorerLogic.test.ts -p node -f esm -o /tmp/fx.mjs && node /tmp/fx.mjs
import type { FileEntry } from "../../api/types";
import {
  filesBytes,
  itemsLabel,
  plural,
  rangePaths,
  stepHistory,
  typeAheadIndex,
  validateName,
  visibleRows,
} from "./explorerLogic";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const entry = (name: string, kind: FileEntry["kind"] = "file", size = 0, modified: number | null = null): FileEntry =>
  ({ name, path: `/d/${name}`, kind, size, modified, permissionsStr: "rw-r--r--", isDirLink: false }) as FileEntry;

const ENTRIES = [entry("b.txt", "file", 30, 3), entry("a10.txt", "file", 10, 1), entry("a2.txt", "file", 20, 2), entry("zdir", "dir"), entry(".oculto")];
const names = (l: FileEntry[]) => l.map((e) => e.name);

// Orden y filtro
eq(names(visibleRows(ENTRIES, "", false, { key: "name", dir: 1 })), ["zdir", "a2.txt", "a10.txt", "b.txt"], "carpetas primero y orden natural");
eq(names(visibleRows(ENTRIES, "", false, { key: "name", dir: -1 })), ["zdir", "b.txt", "a10.txt", "a2.txt"], "nombre descendente");
eq(names(visibleRows(ENTRIES, "", true, { key: "size", dir: 1 })), ["zdir", ".oculto", "a10.txt", "a2.txt", "b.txt"], "por tamaño con ocultos");
eq(names(visibleRows(ENTRIES, "", false, { key: "modified", dir: -1 })), ["zdir", "b.txt", "a2.txt", "a10.txt"], "por fecha descendente");
eq(names(visibleRows(ENTRIES, " A ", false, { key: "name", dir: 1 })), ["a2.txt", "a10.txt"], "filtro sin mayúsculas ni espacios");

// Nombres
eq(validateName("  "), "Escribe un nombre", "vacío");
eq(validateName("a/b"), "El nombre no puede contener «/»", "con barra");
eq(validateName(".."), "Ese nombre no es válido", "punto punto");
eq(validateName(" ok.txt "), null, "válido");
eq(plural(1, "elemento", "elementos"), "1 elemento", "singular");
eq(plural(3, "elemento", "elementos"), "3 elementos", "plural");
eq(itemsLabel(1, "x.txt"), "«x.txt»", "un elemento por nombre");
eq(itemsLabel(2, "x.txt"), "2 elementos", "varios");
eq(filesBytes(ENTRIES), 60, "las carpetas no suman");

// Historial
eq(stepHistory({ back: ["/a"], fwd: ["/c"] }, "push", "/b"), { back: ["/a", "/b"], fwd: [] }, "carpeta nueva borra adelante");
eq(stepHistory({ back: ["/a"], fwd: ["/c"] }, "back", "/b"), { back: [], fwd: ["/b", "/c"] }, "atrás");
eq(stepHistory({ back: ["/a"], fwd: ["/c", "/d"] }, "forward", "/b"), { back: ["/a", "/b"], fwd: ["/d"] }, "adelante");
eq(stepHistory({ back: Array.from({ length: 100 }, (_, i) => `/${i}`), fwd: [] }, "push", "/x").back.length, 100, "máximo 100");

// Rango y búsqueda rápida
const ROWS = visibleRows(ENTRIES, "", false, { key: "name", dir: 1 });
eq(rangePaths(ROWS, 3, 1), ["/d/a2.txt", "/d/a10.txt", "/d/b.txt"], "rango al revés");
eq(typeAheadIndex(ROWS, -1, "a"), 1, "primera con «a»");
eq(typeAheadIndex(ROWS, 1, "a"), 2, "repetir la letra pasa a la siguiente");
eq(typeAheadIndex(ROWS, 2, "a"), 1, "da la vuelta");
eq(typeAheadIndex(ROWS, 1, "a1"), 2, "varias letras desde la actual");
eq(typeAheadIndex(ROWS, 0, "q"), -1, "sin coincidencias");
eq(typeAheadIndex([], -1, "a"), -1, "lista vacía");

console.log(`explorerLogic: ${passed} comprobaciones OK`);
