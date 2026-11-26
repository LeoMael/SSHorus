// Pruebas del formulario de «Nuevo usuario con clave»: grupos, shell por defecto y validación.
import { defaultShell, parseGroupList, validateKeyUserForm, type KeyUserFormInput } from "./keyUserForm";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICZm9C4sWqQjlgtug0eu7n8xh8h3oGFuNpS0Rq3vCc5z ana@portátil";

eq(parseGroupList(" docker, video ,,"), ["docker", "video"], "grupos separados por comas");
eq(parseGroupList(""), [], "sin grupos");

eq(defaultShell(["/bin/sh", "/usr/bin/bash"]), "/usr/bin/bash", "bash antes que sh");
eq(defaultShell(["/bin/zsh", "/bin/sh"]), "/bin/sh", "sh si no hay bash");
eq(defaultShell([]), "/bin/sh", "sin /etc/shells");

const base: KeyUserFormInput = {
  name: "deploy",
  users: ["root", "ana"],
  groups: ["root", "docker", "ana"],
  toolset: "shadow",
  key: { line: `  ${ED}  ` },
  extraGroups: [],
  sudo: null,
};
const v = (p: Partial<KeyUserFormInput>) => validateKeyUserForm({ ...base, ...p });

eq(v({}), { errors: {}, publicKey: ED }, "todo bien: llave recortada");
eq(Object.keys(v({ name: "" }).errors), ["name"], "sin nombre");
eq(v({ name: "ana" }).errors.name, "Ya existe un usuario con ese nombre", "usuario repetido");
eq(!!v({ name: "docker" }).errors.name, true, "con useradd choca con un grupo");
eq(v({ name: "docker", toolset: "busybox" }).errors.name, undefined, "con busybox no choca");
eq(v({ key: "Genera la llave primero" }).errors.key, "Genera la llave primero", "falta la llave");
eq(!!v({ key: { line: "esto no es una llave" } }).errors.key, true, "llave mal escrita");
eq(v({ key: { line: "nada" } }).publicKey, "", "sin llave válida no hay línea");
eq(v({ extraGroups: ["docker"] }).errors.groups, undefined, "grupo que existe");
eq(v({ extraGroups: ["web"] }).errors.groups, "El grupo «web» no existe en el servidor", "grupo que no existe");
eq(v({ extraGroups: ["web"], groups: [] }).errors.groups, undefined, "sin lista de grupos no se comprueba");
eq(v({ extraGroups: ["Mal"] }).errors.groups?.startsWith("«Mal»:"), true, "nombre de grupo inválido");
eq(v({ sudo: { ok: false, error: "Muy corta" } }).errors.sudo, "Muy corta", "contraseña de sudo");
eq(v({ sudo: { ok: true } }).errors.sudo, undefined, "contraseña de sudo bien");

console.log(`keyUserForm: ${passed} comprobaciones correctas`);
