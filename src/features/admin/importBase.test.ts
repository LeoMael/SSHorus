// Pruebas de «Añadir a SSHorus»: de qué servidor se copian host y puerto, y nombres de cada usuario.
// Ejecutar: npx rolldown src/features/admin/importBase.test.ts -p node -f esm -o /tmp/ib.mjs && node /tmp/ib.mjs
import type { ServerProfile } from "../../api/types";
import { capitalize, defaultServerNames, resolveImportBase } from "./importBase";

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

console.log(`importBase: ${passed} comprobaciones correctas`);
