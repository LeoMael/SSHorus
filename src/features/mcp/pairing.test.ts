// Pruebas de los permisos de partida y los resúmenes del emparejado de asistentes.
import type { McpPairedClient } from "../../api/mcp";
import { accessSummary, autoAllowed, cleanAccess, initialAccess, levelOf, sortClients } from "./pairing";

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

eq(initialAccess(["a", "b"], {}, false), { a: "read", b: "read" }, "nuevo: solo lectura en todos");
eq(initialAccess(["a", "b"], { a: "full" }, true), { a: "full", b: "none" }, "reemparejar: lo que tenía");
// Uno que ya existe sin acceso a nada sigue sin acceso (no pasa a «Solo lectura» en todos).
eq(initialAccess(["a", "b"], {}, true), { a: "none", b: "none" }, "cambiar permisos: sin acceso sigue igual");
eq(levelOf({ a: "custom" }, "a"), "full", "solo lo marcado se ve como completo");
eq(levelOf({}, "z"), "none", "sin dato = sin acceso");
eq(cleanAccess({ a: "none", b: "read" }), { b: "read" }, "sin los «sin acceso»");
eq(accessSummary({ a: "full", b: "read", c: "none" }, servers), "web-prod: Completo · db: Solo lectura", "resumen");
eq(accessSummary({}, servers), "Sin acceso a ningún servidor", "resumen vacío");

const c = (id: string, createdAt: number, lastUsed: number | null) =>
  ({ id, name: id, program: "", cwd: null, createdAt, lastUsed, access: {}, via: "bridge" }) as McpPairedClient;
eq(sortClients([c("viejo", 1, null), c("usado", 2, 50), c("nuevo", 10, null)]).map((x) => x.id), ["usado", "nuevo", "viejo"], "orden por uso");

const codex = { ...c("codex", 1, null), access: { b: "full" } } as McpPairedClient;
eq(autoAllowed("a", "full", []), true, "automático: token general con Completo");
eq(autoAllowed("b", "none", [codex]), true, "automático: un asistente con Completo basta");
eq(autoAllowed("a", "read", [codex]), false, "automático: nadie con Completo ahí");

console.log(`pairing: ${passed} comprobaciones correctas`);
