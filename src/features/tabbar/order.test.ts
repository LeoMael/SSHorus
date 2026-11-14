// Pruebas del orden de la barra de pestañas.
// Ejecutar: npx rolldown src/features/tabbar/order.test.ts -p node -f esm -o /tmp/order.mjs && node /tmp/order.mjs
import { moveById, slotInGroup } from "./order";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const ids = (l: readonly { id: string }[]) => l.map((t) => t.id);
const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
eq(ids(moveById(list, "a", 2)), ["b", "c", "a"], "al final");
eq(ids(moveById(list, "c", 0)), ["c", "a", "b"], "al principio");
eq(ids(moveById(list, "b", 9)), ["a", "c", "b"], "índice acotado");
eq(moveById(list, "z", 0) === list, true, "no está: misma lista");
eq(moveById(list, "b", 1) === list, true, "mismo sitio: misma lista");

const groups = [["s1", "s2"], ["l1"], ["f1", "f2"]];
eq(slotInGroup(groups, "s1", 1), { group: 0, index: 1 }, "servidor dentro de su grupo");
eq(slotInGroup(groups, "s1", 2), null, "servidor sobre una local: no");
eq(slotInGroup(groups, "f2", 3), { group: 2, index: 0 }, "panel dentro de su grupo");
eq(slotInGroup(groups, "f1", 2), null, "panel sobre una local: no");
eq(slotInGroup(groups, "l1", 2), { group: 1, index: 0 }, "local en su sitio");
eq(slotInGroup(groups, "x", 0), null, "no está");
eq(slotInGroup([[], ["f1", "f2"]], "f1", 1), { group: 1, index: 1 }, "sin pestañas de servidor");

console.log(`order: ${passed} pruebas OK`);
