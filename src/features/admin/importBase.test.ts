// Pruebas de «Añadir a SSHorus»: de qué servidor se copian host y puerto, nombres y llave de cada usuario.
// Ejecutar: npx rolldown src/features/admin/importBase.test.ts -p node -f esm -o /tmp/ib.mjs && node /tmp/ib.mjs
import type { LocalPrivateKey } from "../../api/localkeys";
import type { ServerProfile } from "../../api/types";
import { capitalize, defaultServerNames, resolveImportBase } from "./importBase";
import { autoKeyPath, defaultKeyPath, keySource, type ImportKey } from "./importKeys";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

// Los dos servidores del usuario: mismo host y puerto, distinto usuario.
const TESIS: ServerProfile = {
  id: "efb8eebd",
  name: "TESIS",
  host: "2.25.131.217",
  port: 22,
  username: "tesis",
  auth: "key",
  keyPath: "/home/u/.ssh/id_ed25519_tesis",
  defaultPath: null,
  color: "#14b8a6",
  sudoMode: "ask",
};
const LEO: ServerProfile = { ...TESIS, id: "fa9518fb", name: "Leo", username: "leo", auth: "password", keyPath: null, color: "#22c55e", sudoMode: "login" };
const servers = [TESIS, LEO];
const session = { name: "Leo", host: "2.25.131.217", port: 22, username: "leo" };

// ── Servidor de la pestaña ──
eq(resolveImportBase(servers, LEO.id, null)?.base.id, LEO.id, "por id: el de la pestaña, no el otro del mismo host");
eq(resolveImportBase(servers, TESIS.id, session)?.base.id, TESIS.id, "el id manda sobre la conexión");
// El fallo: la lista de servidores aún vacía (sin cargar) dejaba el diálogo sin host ni usuarios.
eq(resolveImportBase([], LEO.id, null), null, "sin lista ni conexión: aún no se sabe");
const fromSession = resolveImportBase([], LEO.id, session);
eq([fromSession?.saved, fromSession?.base.host, fromSession?.base.port, fromSession?.base.id], [false, "2.25.131.217", 22, ""], "sin lista: host y puerto de la conexión");
eq(resolveImportBase(servers, "borrado", session)?.base.id, LEO.id, "id que ya no existe: el guardado con mismo host, puerto y usuario");
eq(resolveImportBase(servers, "", { ...session, username: "otro" })?.saved, false, "conexión sin servidor guardado");

// ── Nombres: «Usuario», sin paréntesis ──
eq(capitalize("ana"), "Ana", "mayúscula");
eq(capitalize("ñandú"), "Ñandú", "ñ");
const names = defaultServerNames(["ana", "leo", "tesis", "Leo"], "2.25.131.217", servers);
eq(names.get("ana"), "Ana", "libre");
eq(names.get("leo"), "Leo · 2.25.131.217", "«Leo» ya existe: con el host");
eq(names.get("tesis"), "Tesis · 2.25.131.217", "«TESIS» ya existe (sin distinguir mayúsculas)");
eq(names.get("Leo"), "Leo · 2.25.131.217 2", "tampoco repite dentro de la lista");

// ── Llave de cada usuario ──
function key(name: string, line: string | null, github = false): ImportKey {
  const k: LocalPrivateKey = { path: `/home/u/.ssh/${name}`, name, kind: "ed25519", comment: "", encrypted: false, publicLine: line, configHosts: [] };
  return { ...k, usage: { github } };
}
const keys = [
  key("id_ed25519_github", "ssh-ed25519 AAAAgh yo@pc", true),
  key("id_ed25519_tesis", "ssh-ed25519 AAAAtesis yo@pc"),
  key("trabajo", "ssh-ed25519 AAAAtrab yo@pc"),
  key("rota", null),
];
eq(defaultKeyPath(TESIS, keys), TESIS.keyPath, "por defecto: la del servidor actual");
eq(defaultKeyPath(LEO, keys), "/home/u/.ssh/id_ed25519_tesis", "servidor con contraseña: la primera que no es de GitHub");
eq(defaultKeyPath({ ...TESIS, keyPath: "~/.ssh/id_ed25519_github" }, keys), "/home/u/.ssh/id_ed25519_tesis", "nunca la de GitHub, aunque la use el servidor");
eq(defaultKeyPath({ ...TESIS, auth: "agent" }, keys), "", "agente SSH");
eq(defaultKeyPath(null, [keys[0]]), "", "solo hay de GitHub: agente");

const fallback = defaultKeyPath(TESIS, keys);
eq(autoKeyPath(["ssh-ed25519 AAAAtrab"], keys, fallback), "/home/u/.ssh/trabajo", "ya autorizada: esa");
eq(autoKeyPath(["ssh-rsa AAAAotra"], keys, fallback), fallback, "ninguna autorizada: la de por defecto");
eq(autoKeyPath(["ssh-ed25519 AAAAgh", "ssh-ed25519 AAAAtrab"], keys, fallback), "/home/u/.ssh/trabajo", "entre autorizadas, mejor la que no es de GitHub");
eq(autoKeyPath(["ssh-ed25519 AAAAgh"], keys, fallback), "/home/u/.ssh/id_ed25519_github", "si solo está autorizada la de GitHub, sirve");
eq(autoKeyPath(null, keys, fallback), fallback, "sin leer: la de por defecto");

eq(keySource("/home/u/.ssh/trabajo", ["ssh-ed25519 AAAAtrab"], keys), "authorized", "ya autorizada (sin comentario)");
eq(keySource("~/.ssh/trabajo", [], keys), "install", "con «~»: se instalará");
eq(keySource("/home/u/.ssh/rota", [], keys), "no-public", "sin parte pública");
eq(keySource("/otra/ruta", [], keys), "no-public", "no está en ~/.ssh");
eq(keySource(" ", [], keys), "agent", "vacía = agente");

console.log(`importBase: ${passed} comprobaciones correctas`);
