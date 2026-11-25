// Pruebas de los permisos de partida y los resúmenes del emparejado de asistentes.
import type { McpPairedClient } from "../../api/mcp";
import { accessSummary, cleanAccess, initialAccess, levelOf, sortClients } from "./pairing";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const servers = [
  { id: "a", name: "web-prod" },
  { id: "b", name: "db" },
  { id: "c", name: "vps" },
];

eq(initialAccess(["a", "b"], {}), { a: "read", b: "read" }, "nuevo: solo lectura en todos");
eq(initialAccess(["a", "b"], { a: "full" }), { a: "full", b: "none" }, "reemparejar: lo que tenía");
eq(levelOf({ a: "custom" }, "a"), "full", "solo lo marcado se ve como completo");
eq(levelOf({}, "z"), "none", "sin dato = sin acceso");
eq(cleanAccess({ a: "none", b: "read" }), { b: "read" }, "sin los «sin acceso»");
eq(accessSummary({ a: "full", b: "read", c: "none" }, servers), "web-prod: Completo · db: Solo lectura", "resumen");
eq(accessSummary({}, servers), "Sin acceso a ningún servidor", "resumen vacío");

const c = (id: string, createdAt: number, lastUsed: number | null) =>
  ({ id, name: id, program: "", cwd: null, createdAt, lastUsed, access: {} }) as McpPairedClient;
eq(sortClients([c("viejo", 1, null), c("usado", 2, 50), c("nuevo", 10, null)]).map((x) => x.id), ["usado", "nuevo", "viejo"], "orden por uso");

console.log(`pairing: ${passed} comprobaciones correctas`);
