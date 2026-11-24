// Convierte los pasos de Administración (ya citados con shQuote) en comandos de la Biblioteca con variables.
// Funciones puras, sin React ni Tauri.
//
// El script va ENTERO entre comillas simples (`sudo sh -c '…'`) y los valores {{variable}} van detrás como
// argumentos $1, $2…: el motor (y la interfaz) los citan como argumentos sueltos, así llegan literales y no
// pueden ampliar el comando. Para reutilizar los planes de `commands.ts` y `web.ts` sin copiarlos, se les pasa
// una marca (`runtime("1")`) en lugar del valor; `shQuote(marca)` se cambia luego por `"$1"`.
import { shQuote } from "../../lib/remote";

const MARK = "\u0001";

/** Valor que se conocerá al ejecutar: `shQuote(runtime("1"))` pasa a ser `"$1"` y `shQuote(runtime("cf"))`, `"$cf"`. */
export function runtime(name: string): string {
  return `${MARK}${name}${MARK}`;
}

/** Cambia cada marca citada por su variable de shell entre comillas dobles. Error si queda alguna suelta. */
export function bindRuntime(script: string): string {
  const out = script.replace(new RegExp(`'${MARK}([A-Za-z0-9_]+)${MARK}'`, "g"), '"$$$1"');
  if (out.includes(MARK)) throw new Error("Hay un valor marcado dentro de otro texto: no se puede pasar como argumento");
  return out;
}

/**
 * Comando de la Biblioteca que ejecuta `steps` como root. `vars` son las variables de la plantilla en el orden
 * de $1, $2… (pueden llevar valor por defecto: «puerto:8080»). `name` es el $0 del script (sale en los errores).
 */
export function sudoCatalogCommand(name: string, steps: string[], vars: string[]): string {
  const script = bindRuntime(["set -e", ...steps].join("\n"));
  return `sudo sh -c ${shQuote(script)} ${name} ${vars.map((v) => `{{${v}}}`).join(" ")}`.trimEnd();
}

/** `if <cond>; then <a>; else <b>; fi` con los pasos de cada rama. */
export function ifElse(cond: string, then: string[], otherwise: string[]): string[] {
  return [`if ${cond}; then`, ...then.map((s) => `  ${s}`), "else", ...otherwise.map((s) => `  ${s}`), "fi"];
}

/** Sale con error (código 2 = dato no válido) si `check` es cierto. */
export function failIf(check: string, message: string): string {
  return `if ${check}; then echo ${shQuote(message)} >&2; exit 2; fi`;
}
