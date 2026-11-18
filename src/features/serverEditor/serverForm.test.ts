// Pruebas de las reglas del formulario de servidor.
// Ejecutar: npx rolldown src/features/serverEditor/serverForm.test.ts -p node -f esm -o /tmp/sf.mjs && node /tmp/sf.mjs
import type { ServerProfile } from "../../api/types";
import {
  buildServerProfile,
  connectionChanged,
  connectionErrors,
  hasErrors,
  initialConnKey,
  initialFields,
  pickAuth,
  secretToSave,
  sudoFormState,
  sudoSecretToSave,
  testCredentials,
  testSignature,
  validateServerForm,
  type SavedState,
  type ServerFormFields,
} from "./serverForm";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const saved: ServerProfile = {
  id: "s1",
  name: "web",
  host: "web.example.com",
  port: 2222,
  username: "deploy",
  auth: "key",
  keyPath: "/home/u/.ssh/id_ed25519",
  defaultPath: "/srv",
  color: "#f00",
  tmux: "always",
  sudoMode: "login",
};

// Valores iniciales.
const blank = initialFields(null, "");
eq([blank.port, blank.auth, blank.remember, blank.sudoMode, blank.tmux], ["22", "password", true, "ask", null], "nuevo: valores por defecto");
const edit = initialFields(saved, "p1");
eq([edit.port, edit.keyPath, edit.projectId, edit.secret], ["2222", saved.keyPath, "p1", ""], "editar: datos del servidor");
eq(edit.sudoMode, "ask", "«login» con llave se muestra como «Pedir cada vez»");

const f = (o: Partial<ServerFormFields>): ServerFormFields => ({ ...blank, host: "h", username: "u", ...o });

// Validación.
eq(validateServerForm(f({}), null), {}, "formulario válido");
eq(validateServerForm(f({ host: "  " }), null).host, "Indica el host o la IP", "sin host");
eq(validateServerForm(f({ host: "a b" }), null).host, "El host no puede tener espacios", "host con espacios");
eq(validateServerForm(f({ username: " " }), null).username, "Indica el usuario", "sin usuario");
eq(validateServerForm(f({ port: "" }), null).port, "Puerto entre 1 y 65535", "puerto vacío");
eq(validateServerForm(f({ port: "70000" }), null).port, "Puerto entre 1 y 65535", "puerto alto");
eq(validateServerForm(f({ auth: "key" }), null).keyPath, "Elige la llave privada", "llave sin ruta");
eq(validateServerForm(f({}), "Alias inválido").alias, "Alias inválido", "error del alias");
const connErr = connectionErrors(validateServerForm(f({ port: "0" }), "Alias inválido"));
eq(Object.keys(connErr), ["host", "port", "username", "keyPath"], "errores de conexión: las cuatro claves");
eq(hasErrors(connErr), true, "puerto malo impide probar");
eq(hasErrors(connectionErrors(validateServerForm(f({}), "Alias inválido"))), false, "el alias no impide probar");

// Elegir autenticación.
eq(pickAuth(f({ sudoMode: "login", secret: "x" }), "key"), { auth: "key", secret: "", sudoMode: "ask" }, "a llave: «login» pasa a «ask»");
eq(pickAuth(f({ sudoMode: "login" }), "password"), { auth: "password", secret: "" }, "a contraseña: «login» se queda");
eq(pickAuth(f({ sudoMode: "saved" }), "agent"), { auth: "agent", secret: "" }, "a agente: «saved» se queda");

// Cambios en la conexión.
const savedKey = initialConnKey(saved);
const editing = initialFields(saved, "");
const changed = (x: ServerFormFields) => connectionChanged(x, false, savedKey);
eq(changed(editing), false, "sin cambios");
eq(changed({ ...editing, host: " WEB.example.com " }), false, "mayúsculas y espacios no cuentan");
eq(changed({ ...editing, name: "otro" }), false, "el nombre no cuenta");
eq(changed({ ...editing, port: "22" }), true, "otro puerto");
eq(changed({ ...editing, secret: "frase" }), true, "secreto escrito");
eq(changed({ ...editing, auth: "agent", secret: "x" }), true, "otro método");
eq(connectionChanged(editing, true, savedKey), true, "uno nuevo siempre");
eq(testSignature({ ...editing, auth: "agent", secret: "a" }) === testSignature({ ...editing, auth: "agent", secret: "b" }), true, "agente: el secreto no cuenta");
eq(testSignature({ ...editing, secret: "a" }) === testSignature({ ...editing, secret: "b" }), false, "llave: el secreto cuenta");

// Armado del perfil.
const built = buildServerProfile("s1", { ...editing, name: " ", host: " h2 ", defaultPath: " " }, sudoFormState(editing, false, null));
eq([built.name, built.host, built.defaultPath, built.keyPath, built.sudoMode], ["h2", "h2", null, saved.keyPath, "ask"], "perfil limpio");
eq(buildServerProfile("", f({ keyPath: "/k" }), sudoFormState(f({}), true, null)).keyPath, null, "sin llave no guarda la ruta");
eq(sudoFormState(f({ sudoMode: "saved" }), true, true).stored, false, "uno nuevo no tiene sudo guardado");
eq(buildServerProfile("", f({ sudoMode: "saved" }), sudoFormState(f({ sudoMode: "saved" }), false, true)).sudoMode, "saved", "sudo guardado");

// Secretos para probar.
const st = (o: Partial<SavedState>): SavedState => ({ isNew: false, savedAuth: "password", hasSecret: true, ...o });
eq(testCredentials(f({ secret: "pw" }), st({})), { password: "pw", useSavedSecret: false }, "contraseña escrita");
eq(testCredentials(f({ auth: "key", secret: "fr" }), st({})), { passphrase: "fr", useSavedSecret: false }, "frase escrita");
eq(testCredentials(f({}), st({})).useSavedSecret, true, "sin escribir: la guardada");
eq(testCredentials(f({ auth: "key" }), st({})).useSavedSecret, false, "guardada de otro método no vale");
eq(testCredentials(f({}), st({ isNew: true })).useSavedSecret, false, "uno nuevo no tiene guardada");

// Secreto al guardar.
eq(secretToSave(f({ secret: "pw" }), st({})), "pw", "escrita y marcada: se guarda");
eq(secretToSave(f({ secret: "pw", remember: false }), st({})), "", "sin marcar con guardada: se borra");
eq(secretToSave(f({ remember: false }), st({ hasSecret: false })), undefined, "sin marcar sin guardada: no se toca");
eq(secretToSave(f({}), st({})), undefined, "sin escribir: no se toca");
eq(secretToSave(f({ auth: "key" }), st({})), "", "cambió a llave: se borra la contraseña antigua");
eq(secretToSave(f({ auth: "agent" }), st({})), "", "cambió a agente: se borra");
eq(secretToSave(f({ auth: "agent" }), st({ savedAuth: "agent" })), undefined, "agente sin cambio: no se toca");
eq(secretToSave(f({ auth: "key" }), st({ isNew: true })), undefined, "uno nuevo: no se toca");

// Contraseña de sudo al guardar.
eq(sudoSecretToSave("saved", "s", null), "s", "saved escrita");
eq(sudoSecretToSave("saved", "", true), undefined, "saved sin escribir: no se toca");
eq(sudoSecretToSave("ask", "", true), "", "otro modo con guardada: se borra");
eq(sudoSecretToSave("login", "", false), undefined, "otro modo sin guardada: no se toca");

console.log(`serverForm: ${passed} pruebas OK`);
