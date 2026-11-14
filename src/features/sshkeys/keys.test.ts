// Pruebas de las llaves SSH locales (funciones puras).
// Ejecutar: npx rolldown src/features/sshkeys/keys.test.ts -p node -f esm -o /tmp/keys.mjs && node /tmp/keys.mjs
import type { LocalPrivateKey } from "../../api/localkeys";
import { findKey, freeKeyName, githubTestCommand, keyLabel, samePath } from "./keys";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const key = (name: string, path: string, extra: Partial<LocalPrivateKey> = {}): LocalPrivateKey => ({
  path,
  name,
  kind: "ed25519",
  comment: "",
  encrypted: false,
  publicLine: null,
  configHosts: [],
  ...extra,
});

// Rutas
eq(samePath("~/.ssh/id_rsa", "/home/ana/.ssh/id_rsa"), true, "~ frente a absoluta");
eq(samePath("/home/ana/.ssh/id_rsa", "~/.ssh/id_rsa"), true, "absoluta frente a ~");
eq(samePath("C:\\Users\\ana\\.ssh\\id_rsa", "C:/Users/ana/.ssh/id_rsa"), true, "barras de Windows");
eq(samePath("~/.ssh/id_rsa", "/home/ana/.ssh/id_rsa_viejo"), false, "otro archivo");
eq(samePath("", "/x"), false, "vacía");

const list = [key("id_ed25519", "/h/.ssh/id_ed25519"), key("trabajo", "/h/.ssh/trabajo")];
eq(findKey(list, "~/.ssh/trabajo")?.name, "trabajo", "encuentra con ~");
eq(findKey(list, "/otra/llave"), null, "no está");

// Etiquetas
eq(keyLabel(key("id_ed25519", "/x", { comment: "ana@pc", encrypted: true })), "id_ed25519 (ed25519 · ana@pc · con frase)", "etiqueta");
eq(keyLabel(key("rara", "/x", { kind: null })), "rara (tipo desconocido)", "sin tipo");

// Nombres libres
eq(freeKeyName([]), "id_ed25519", "libre");
eq(freeKeyName(["id_ed25519", "id_ed25519_2"]), "id_ed25519_3", "siguiente libre");
eq(freeKeyName(["id_ed25519"], "id_ed25519_github"), "id_ed25519_github", "otra base");

// Prueba con GitHub
eq(githubTestCommand("id_ed25519", "/h/.ssh/id_ed25519"), "ssh -T git@github.com", "llave por defecto");
eq(githubTestCommand("gh", "/h/.ssh/gh"), "ssh -i /h/.ssh/gh -T git@github.com", "llave con otro nombre");
eq(githubTestCommand("gh", "C:\\Users\\Ana B\\.ssh\\gh"), 'ssh -i "C:\\Users\\Ana B\\.ssh\\gh" -T git@github.com', "ruta con espacios");

console.log(`keys: ${passed} comprobaciones OK`);
