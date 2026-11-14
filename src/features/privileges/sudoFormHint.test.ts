// Pruebas de la sección «Contraseña de sudo» del formulario de servidor.
// Ejecutar: npx rolldown src/features/privileges/sudoFormHint.test.ts -p node -f esm -o /tmp/sfh.mjs && node /tmp/sfh.mjs
import { shownSudoMode, sudoFormHint, sudoModesFor, sudoModeToSave, type SudoFormState } from "./sudoFormHint";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const base: SudoFormState = { mode: "ask", auth: "password", typed: false, stored: false, rememberLogin: true };
const st = (o: Partial<SudoFormState>): SudoFormState => ({ ...base, ...o });
const MISSING = "Escribe la contraseña de sudo o te la pediremos cada vez.";
const KEY_TEXT = "Entras con llave SSH: no hay contraseña de conexión. Si quieres que sudo no te la pida, elige «Guardar».";

// Modos que se pueden elegir.
eq(sudoModesFor("password"), ["ask", "login", "saved"], "con contraseña, los tres");
eq(sudoModesFor("key"), ["ask", "saved"], "con llave, sin «La de la conexión»");
eq(sudoModesFor("agent"), ["ask", "saved"], "con agente, sin «La de la conexión»");

// «login» con llave o agente (p. ej. desde la sincronización de GitHub) se muestra como «Pedir cada vez».
eq(shownSudoMode("login", "key"), "ask", "login + llave → ask");
eq(shownSudoMode("login", "agent"), "ask", "login + agente → ask");
eq(shownSudoMode("login", "password"), "login", "login + contraseña se queda");
eq(shownSudoMode("saved", "key"), "saved", "saved se queda");
eq(sudoFormHint(st({ mode: "login", auth: "key" })), { text: KEY_TEXT, warn: false }, "login + llave explica");

// «Guardar» sin contraseña: aviso y se guarda como «Pedir cada vez».
eq(sudoFormHint(st({ mode: "saved" })), { text: MISSING, warn: true }, "saved vacío avisa");
eq(sudoModeToSave(st({ mode: "saved" })), "ask", "saved vacío se guarda como ask");
eq(sudoFormHint(st({ mode: "saved", auth: "key" })).warn, true, "saved vacío con llave avisa");
// Con contraseña escrita o guardada, no.
eq(sudoFormHint(st({ mode: "saved", typed: true })).warn, false, "saved escrita no avisa");
eq(sudoModeToSave(st({ mode: "saved", typed: true })), "saved", "saved escrita se guarda");
eq(sudoFormHint(st({ mode: "saved", stored: true })).warn, false, "saved guardada no avisa");
eq(sudoModeToSave(st({ mode: "saved", stored: true })), "saved", "saved guardada se guarda");
// Si no se sabe si hay una guardada (llavero no disponible), no se toca.
eq(sudoFormHint(st({ mode: "saved", stored: null })).warn, false, "saved desconocido no avisa");
eq(sudoModeToSave(st({ mode: "saved", stored: null })), "saved", "saved desconocido se guarda igual");

// Entrar con llave o agente: explicación en «Pedir cada vez».
eq(sudoFormHint(st({ auth: "key" })).text, KEY_TEXT, "ask + llave explica");
eq(sudoFormHint(st({ auth: "agent" })).text.startsWith("Entras con agente SSH:"), true, "ask + agente explica");
eq(sudoFormHint(st({})).text, "Se pide al administrar y se olvida al cerrar la conexión.", "ask + contraseña normal");

// Resto de casos.
eq(sudoModeToSave(st({ mode: "login", auth: "key" })), "ask", "login + llave se guarda como ask");
eq(sudoModeToSave(st({ mode: "login" })), "login", "login + contraseña se guarda");
eq(sudoFormHint(st({ mode: "login", rememberLogin: false })).text, "Marca «Guardar contraseña» para usarla con sudo.", "login sin guardar");
eq(sudoFormHint(st({ mode: "login" })).text, "Usa la contraseña de arriba (tiene que estar guardada).", "login normal");

console.log(`sudoFormHint: ${passed} pruebas OK`);
