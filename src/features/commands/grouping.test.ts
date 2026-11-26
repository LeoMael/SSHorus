// Pruebas de cómo se agrupan, cuentan y recorren los comandos de la Biblioteca.
import { countByCategory, groupCommands, stepSelection } from "./grouping";
import { MY_CATEGORY } from "./state";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const it = (id: string, category: string, group: string) => ({ id, category, group });
const items = [it("a", "Red", "Puertos"), it("b", "Red", "DNS"), it("c", "Red", "Puertos"), it("d", MY_CATEGORY, "Míos")];

eq(countByCategory(items), { Red: 3, [MY_CATEGORY]: 1 }, "cuenta por categoría");
eq(countByCategory([]), {}, "sin comandos");

const normal = groupCommands(items.slice(0, 3), false);
eq(normal.map((g) => g.label), ["Puertos", "DNS"], "grupos en el orden en que aparecen");
eq(normal[0].items.map((x) => x.id), ["a", "c"], "cada grupo junta los suyos");

const search = groupCommands(items, true);
eq(search.map((g) => g.label), ["Red · Puertos", "Red · DNS", "Mis comandos · Míos"], "buscando: con la categoría delante");
eq(search[0].key, search[0].label, "la clave es la etiqueta");

const ids = ["a", "b", "c"];
eq(stepSelection(ids, "a", 1), "b", "baja uno");
eq(stepSelection(ids, "c", 1), "c", "no pasa del último");
eq(stepSelection(ids, "a", -1), "a", "no pasa del primero");
eq(stepSelection(ids, null, 1), "a", "sin elegido: el primero");
eq(stepSelection(ids, "x", -1), "a", "elegido que ya no está: el primero");
eq(stepSelection([], "a", 1), null, "lista vacía");

console.log(`grouping: ${passed} pruebas OK`);
