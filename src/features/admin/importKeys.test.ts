// Pruebas de «Añadir a SSHorus»: cómo entra cada usuario, llaves nuevas y qué se instala.
// Ejecutar: npx rolldown src/features/admin/importKeys.test.ts -p node -f esm -o /tmp/ik.mjs && node /tmp/ik.mjs
import type { LocalPrivateKey } from "../../api/localkeys";
import {
  accessStatus,
  availableMethods,
  byUser,
  defaultKeyPath,
  importItems,
  keySlug,
  nameNewKeys,
  newKeyGroups,
  newKeyName,
  rowAccess,
  SHARED_KEY,
  type AccessContext,
  type ImportKey,
} from "./importKeys";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

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
const TESIS = { auth: "key", keyPath: "/home/u/.ssh/id_ed25519_tesis" };

// ── Llave mía por defecto: nunca la de GitHub ──
eq(defaultKeyPath(TESIS, keys), TESIS.keyPath, "la del servidor actual");
eq(defaultKeyPath({ auth: "password", keyPath: null }, keys), "/home/u/.ssh/id_ed25519_tesis", "con contraseña: la primera que no es de GitHub");
eq(defaultKeyPath({ auth: "key", keyPath: "~/.ssh/id_ed25519_github" }, keys), "/home/u/.ssh/id_ed25519_tesis", "nunca la de GitHub, aunque la use el servidor");
eq(defaultKeyPath({ auth: "key", keyPath: "/home/u/.ssh/rota" }, keys), "/home/u/.ssh/id_ed25519_tesis", "sin parte pública no sirve");
eq(defaultKeyPath(null, [keys[0]]), "", "solo hay de GitHub: ninguna");

const fallbackKey = defaultKeyPath(TESIS, keys);
const ctx = (authorized: string[] | null, canInstall = true): AccessContext => ({ authorized, keys, canInstall, fallbackKey });

// ── Métodos y valor por defecto ──
eq(availableMethods(ctx(["ssh-ed25519 AAAAtrab"])), ["authorized", "new-key", "my-key", "password"], "todos");
eq(availableMethods(ctx([])), ["new-key", "my-key", "password"], "sin llave autorizada");
eq(availableMethods(ctx(null, false)), ["my-key", "password"], "sin sudo: no se crea ni se comprueba");
eq(availableMethods({ ...ctx([]), keys: [] }), ["new-key", "password"], "sin llaves en este equipo");

const auth = rowAccess(ctx(["ssh-ed25519 AAAAgh", "ssh-ed25519 AAAAtrab"]));
eq([auth.method, auth.keyPath, auth.install], ["authorized", "/home/u/.ssh/trabajo", false], "ya autorizada: esa, mejor la que no es de GitHub");
eq(rowAccess(ctx(["ssh-ed25519 AAAAgh"])).keyPath, "/home/u/.ssh/id_ed25519_github", "si solo está la de GitHub autorizada, sirve");
eq(rowAccess(ctx(["ssh-ed25519 AAAAgh", "ssh-ed25519 AAAAtrab"]), { keyPath: "/home/u/.ssh/id_ed25519_github" }).keyPath, "/home/u/.ssh/id_ed25519_github", "otra autorizada elegida a mano");
const fresh = rowAccess(ctx(["ssh-rsa AAAAotra"]));
eq([fresh.method, fresh.install, fresh.problem], ["new-key", true, null], "ninguna autorizada: crear una nueva");
eq(rowAccess(ctx(null, false)).method, "password", "sin sudo: contraseña");
eq(rowAccess(ctx([]), { method: "authorized" }).method, "new-key", "lo elegido que ya no vale: el de por defecto");

// ── Llave mía ──
const mine = rowAccess(ctx([]), { method: "my-key" });
eq([mine.keyPath, mine.install], [fallbackKey, true], "la de por defecto, se instalará");
eq(rowAccess(ctx(["ssh-ed25519 AAAAtrab"]), { method: "my-key", keyPath: "~/.ssh/trabajo" }).install, false, "ya autorizada (con «~»): no se instala");
eq(rowAccess(ctx([]), { method: "my-key", keyPath: "/home/u/.ssh/rota" }).problem, "Elige una llave", "sin parte pública: hay que elegir otra");
eq(rowAccess({ ...ctx([]), fallbackKey: "" }, { method: "my-key" }).problem, "Elige una llave", "sin propuesta (solo de GitHub)");
const noSudo = rowAccess(ctx(null, false), { method: "my-key" });
eq([noSudo.install, accessStatus(noSudo, false).text], [false, "Sin comprobar"], "sin sudo: no se instala");

// ── Contraseña ──
const pw = rowAccess(ctx([]), { method: "password", password: "s3creta" });
eq([pw.password, pw.install, accessStatus(pw, true).text], ["s3creta", false, "Se guardará"], "contraseña escrita");
eq(accessStatus(rowAccess(ctx([]), { method: "password" }), true).text, "Se pide al conectar", "sin escribir");
eq(rowAccess(ctx([]), { password: "x" }).password, "", "la contraseña solo cuenta con el método contraseña");

// ── Estado ──
eq(accessStatus(auth, true).tone, "green", "autorizada en verde");
eq(accessStatus(fresh, true).text, "Llave nueva", "llave nueva");
eq(accessStatus(mine, true).text, "Se instalará", "se instalará");

// ── Nombres de llaves nuevas ──
eq(keySlug("Mi VPS (Lima) ñandú"), "mi-vps-lima-nandu", "sin tildes ni espacios");
eq(keySlug("2.25.131.217"), "2.25.131.217", "IP tal cual");
eq(newKeyName("TESIS", "ana", []), "id_ed25519_tesis_ana", "servidor y usuario");
eq(newKeyName("TESIS", null, []), "id_ed25519_tesis", "compartida: sin usuario");
eq(newKeyName("TESIS", "ana", ["id_ed25519_tesis_ana"]), "id_ed25519_tesis_ana_2", "no sobrescribe");
eq(newKeyName("x".repeat(80), "ana", []).length, 60, "máx. 60 (cabe «_2»)");
eq(newKeyName("", "ana", []), "id_ed25519_ana", "sin servidor");
eq(newKeyName("web.pub", null, []), "id_ed25519_web", "nunca termina en «.pub»");

eq(newKeyGroups(["ana", "leo"], false), [{ id: "ana", users: ["ana"] }, { id: "leo", users: ["leo"] }], "una por usuario");
eq(newKeyGroups(["ana", "leo"], true), [{ id: SHARED_KEY, users: ["ana", "leo"] }], "compartida");
eq(newKeyGroups(["ana"], true), [{ id: "ana", users: ["ana"] }], "compartida con uno solo: la suya");

const named = nameNewKeys(newKeyGroups(["ana", "Ana"], false), "web", ["id_ed25519_web_ana"]);
eq([...named.values()], ["id_ed25519_web_ana_2", "id_ed25519_web_ana_3"], "sin repetir entre ellas");
eq([...nameNewKeys(newKeyGroups(["ana", "leo"], false), "web", [], new Set(["ana"])).keys()], ["leo"], "las ya creadas no se renombran");

eq([...byUser(newKeyGroups(["ana", "leo"], true), new Map([[SHARED_KEY, "k"]]))], [["ana", "k"], ["leo", "k"]], "compartida: la misma para todos");
eq([...byUser(newKeyGroups(["ana", "leo"], false), new Map([["leo", "k"]]))], [["leo", "k"]], "por usuario: solo los que la tienen");

// ── Servidores y llaves a instalar ──
const NEW = { privatePath: "/home/u/.ssh/id_ed25519_web_leo", publicLine: "ssh-ed25519 AAAAnueva yo@pc" };
const res = importItems(
  [
    { user: "ana", name: "Ana", access: auth },
    { user: "leo", name: "Leo", access: fresh },
    { user: "eva", name: "Eva", access: mine },
    { user: "bob", name: "Bob", access: pw },
  ],
  new Map([["leo", NEW]]),
  keys,
);
if (typeof res === "string") throw new Error(res);
eq(
  res.items.map((i) => [i.user, i.auth.kind === "key" ? i.auth.keyPath : "password", i.password]),
  [
    ["ana", "/home/u/.ssh/trabajo", ""],
    ["leo", NEW.privatePath, ""],
    ["eva", fallbackKey, ""],
    ["bob", "password", "s3creta"],
  ],
  "llave o contraseña de cada uno",
);
eq(res.install, [{ user: "leo", publicLine: NEW.publicLine }, { user: "eva", publicLine: "ssh-ed25519 AAAAtesis yo@pc" }], "solo se instalan la nueva y la mía");
eq(importItems([{ user: "leo", name: "Leo", access: fresh }], new Map(), keys), "leo: falta crear su llave nueva", "llave nueva sin crear");
eq(importItems([{ user: "eva", name: "Eva", access: rowAccess(ctx([]), { method: "my-key", keyPath: "/nada" }) }], new Map(), keys), "eva: Elige una llave", "fila con problema");

console.log(`importKeys: ${passed} comprobaciones correctas`);
