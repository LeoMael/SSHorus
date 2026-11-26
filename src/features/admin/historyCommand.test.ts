// Pruebas del texto del historial de Administración: nota de elevación y que la contraseña no aparece.
import { elevationNote, historyCommand } from "./historyCommand";
import { MASK } from "./shell";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

eq(elevationNote({ kind: "root" }), "# como root", "root");
eq(elevationNote({ kind: "nopasswd", tool: "doas" }), "# como root con doas -n", "doas -n");
eq(elevationNote({ kind: "none" }), "# sin elevar", "sin elevar");
eq(elevationNote({ kind: "password", password: "secreta" }).includes("secreta"), false, "la contraseña de sudo no sale");
eq(elevationNote({ kind: "password", password: "x" }).endsWith(`${MASK})`), true, "sale enmascarada");

const plan = { action: "Cambiar contraseña", steps: ["chpasswd"], secret: "ana:clave\n", secretLabel: `ana:${MASK}` };
const text = historyCommand(plan, { kind: "root" });
eq(text, `# como root\nchpasswd\n# entrada estándar: ana:${MASK}`, "con entrada estándar");
eq(text.includes("clave"), false, "el secreto no se guarda");
eq(historyCommand({ action: "x", steps: ["a", "b"] }, { kind: "root" }), "# como root\na\nb", "sin entrada estándar");

console.log(`historyCommand: ${passed} comprobaciones correctas`);
