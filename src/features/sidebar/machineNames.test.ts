// Pruebas del nombre propio de una máquina en la barra lateral: guardar, volver al automático, leer lo
// guardado sin fiarse, la búsqueda y cómo se ve en el árbol.
import type { ServerProfile } from "../../api/types";
import { groupByMachine, machineKey } from "./machineGroups";
import { MACHINE_NAME_MAX, matchesMachineName, parseMachineNames, validateMachineName, withMachineName } from "./machineNames";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

function srv(id: string, host: string, port = 22): ServerProfile {
  return { id, name: id, host, port, username: id, auth: "key", keyPath: null, defaultPath: null, color: null };
}

const a = srv("a", "2.25.131.217");
const b = srv("b", "2.25.131.217");
const key = machineKey(a);

// ── Poner y quitar ──
const named = withMachineName({}, key, "  VPS de la tesis ", "2.25.131.217");
eq(named, { [key]: "VPS de la tesis" }, "se guarda sin espacios de más");
eq(withMachineName(named, key, "", "2.25.131.217"), {}, "vacío: vuelve al nombre automático");
eq(withMachineName(named, key, "2.25.131.217", "2.25.131.217"), {}, "igual que el automático: no se guarda");
eq(withMachineName(named, "otra:22", "Casa", "otra"), { [key]: "VPS de la tesis", "otra:22": "Casa" }, "las demás no cambian");

// ── Validar ──
eq(validateMachineName(""), null, "vacío vale");
eq(validateMachineName("x".repeat(MACHINE_NAME_MAX + 1)) !== null, true, "demasiado largo");

// ── Lo guardado ──
eq(parseMachineNames({ [key]: " VPS ", n: 3, e: "", l: "x".repeat(MACHINE_NAME_MAX + 1) }), { [key]: "VPS" }, "solo textos válidos");
eq(parseMachineNames(null), {}, "nada guardado");
eq(parseMachineNames(["x"]), {}, "una lista no vale");

// ── En el árbol ──
const [node] = groupByMachine([a, b], () => null, named);
eq(node.kind === "machine" ? [node.label, node.host] : null, ["VPS de la tesis", "2.25.131.217"], "se ve el nombre propio; el host sigue a mano");
const [plain] = groupByMachine([a, b], () => null);
eq(plain.kind === "machine" ? plain.label : null, "2.25.131.217", "sin nombre: el host");

// ── Búsqueda ──
eq(matchesMachineName(a, named, "tesis"), true, "se encuentra por el nombre propio");
eq(matchesMachineName(a, {}, "tesis"), false, "sin nombre propio, no");
eq(matchesMachineName(srv("c", "otro"), named, "tesis"), false, "otra máquina, no");

console.log(`machineNames: ${passed} comprobaciones correctas`);
