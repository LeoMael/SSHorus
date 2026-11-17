// Comandos de la Biblioteca para editar y borrar usuarios (también los usa el asistente por MCP con
// «Solo lo marcado»). Reutilizan los planes de Administración (`commands.ts`) con los valores como $1, $2…
// Funciones puras, sin React ni Tauri.
import { addMemberStep, deleteUserPlan, detectEnv, editUserPlan, lockUserPlan, removeMemberStep, type AdminEnv } from "./commands";
import { failIf, ifElse, runtime, sudoCatalogCommand } from "./catalogScript";
import { shQuote } from "./shell";

/** Una fila de la Biblioteca generada aquí. `flags` como en catalog.ts (r, d, s, i). */
export interface GeneratedRow {
  id: string;
  name: string;
  description: string;
  command: string;
  flags: string;
}

const SHADOW: AdminEnv = detectEnv(new Set(["useradd", "usermod", "gpasswd", "chage"]), null, []);
const BUSYBOX: AdminEnv = detectEnv(new Set(), null, []);
const U = runtime("1");
const SECOND = runtime("2");
const HAS_USERMOD = "command -v usermod >/dev/null 2>&1";

/** Mismas reglas que `NAME_RE` (shell.ts), en sh. */
function nameChecks(arg: string, what: string): string[] {
  return [
    `case "$${arg}" in [a-z_]*) ;; *) echo ${shQuote(`Nombre de ${what} no válido`)} >&2; exit 2;; esac`,
    `case "$${arg}" in *[!a-z0-9_-]*) echo ${shQuote(`Nombre de ${what} no válido`)} >&2; exit 2;; esac`,
  ];
}

const PRELUDE = ["PATH=$PATH:/usr/sbin:/sbin", ...nameChecks("1", "usuario"), `id "$1" >/dev/null 2>&1 || { echo 'No existe ese usuario' >&2; exit 1; }`];

/** No se bloquea ni se borra root ni la cuenta con la que SSHorus está conectado. */
const NOT_ROOT_OR_SELF = failIf(
  '[ "$1" = root ] || [ "$1" = "${SUDO_USER:-}" ]',
  "No se bloquea ni se borra root ni el usuario con el que estás conectado",
);

const GROUP_EXISTS = `if ! grep -q "^$2:" /etc/group; then echo 'No existe ese grupo' >&2; exit 1; fi`;

/** Pasos según haya shadow-utils (usermod) o solo busybox. */
function byToolset(steps: (env: AdminEnv) => string[]): string[] {
  return ifElse(HAS_USERMOD, steps(SHADOW), steps(BUSYBOX));
}

const cmd = (id: string, steps: string[], vars: string[]) => sudoCatalogCommand(id, [...PRELUDE, ...steps], vars);

export const USER_EDIT_ROWS: GeneratedRow[] = [
  {
    id: "anadir-a-grupo",
    name: "Añadir a un grupo",
    description: "Añade el usuario a un grupo que ya existe.",
    command: cmd(
      "anadir-a-grupo",
      [...nameChecks("2", "grupo"), GROUP_EXISTS, ...byToolset((env) => [addMemberStep(env, U, SECOND)])],
      ["usuario", "grupo"],
    ),
    flags: "s",
  },
  {
    id: "quitar-de-grupo",
    name: "Quitar de un grupo",
    description: "Quita el usuario de un grupo (no borra el grupo).",
    command: cmd(
      "quitar-de-grupo",
      [...nameChecks("2", "grupo"), ...byToolset((env) => [removeMemberStep(env, U, SECOND)])],
      ["usuario", "grupo"],
    ),
    flags: "s",
  },
  {
    id: "cambiar-shell",
    name: "Cambiar el shell",
    description: "Cambia el shell de inicio (ruta absoluta que exista, p. ej. /bin/bash). Necesita usermod.",
    command: cmd(
      "cambiar-shell",
      [
        failIf(`case "$2" in /*) false;; *) true;; esac`, "El shell debe ser una ruta absoluta"),
        failIf(`[ ! -x "$2" ]`, "Ese shell no existe en el servidor"),
        ...ifElse(HAS_USERMOD, editUserPlan(SHADOW, { name: U, shell: SECOND, addGroups: [], removeGroups: [], forceChange: false })?.steps ?? [], [
          "echo 'Sin usermod (busybox) no se puede cambiar el shell' >&2",
          "exit 1",
        ]),
      ],
      ["usuario", "nuevo_shell:/bin/bash"],
    ),
    flags: "s",
  },
  {
    id: "bloquear-usuario",
    name: "Bloquear usuario",
    description: "Bloquea la contraseña del usuario (no podrá entrar con ella). No borra nada.",
    command: cmd("bloquear-usuario", [NOT_ROOT_OR_SELF, ...byToolset((env) => lockUserPlan(env, U, true).steps)], ["usuario"]),
    flags: "s",
  },
  {
    id: "desbloquear-usuario",
    name: "Desbloquear usuario",
    description: "Vuelve a permitir la contraseña del usuario.",
    command: cmd("desbloquear-usuario", byToolset((env) => lockUserPlan(env, U, false).steps), ["usuario"]),
    flags: "s",
  },
];

export const USER_DELETE_ROWS: GeneratedRow[] = [
  {
    id: "borrar-usuario",
    name: "Borrar usuario",
    description: "Elimina el usuario y deja su carpeta personal. Nunca root ni el usuario conectado.",
    command: cmd("borrar-usuario", [NOT_ROOT_OR_SELF, ...byToolset((env) => deleteUserPlan(env, U, false).steps)], ["usuario"]),
    flags: "sd",
  },
  {
    id: "borrar-usuario-y-carpeta",
    name: "Borrar usuario y su carpeta",
    description: "Elimina el usuario y su carpeta personal. Nunca root ni el usuario conectado.",
    command: cmd("borrar-usuario-y-carpeta", [NOT_ROOT_OR_SELF, ...byToolset((env) => deleteUserPlan(env, U, true).steps)], ["usuario"]),
    flags: "sd",
  },
];
