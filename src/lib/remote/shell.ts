// Citas para un shell POSIX (sh, dash, ash, bash). Funciones puras, sin React ni Tauri.

/**
 * Cita un argumento: `'…'` con las comillas simples internas como `'\''`. Siempre cita, aunque no haga
 * falta: el resultado es un único argumento literal.
 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Une argumentos citándolos todos. */
export function shJoin(args: string[]): string {
  return args.map(shQuote).join(" ");
}

/** Caracteres que no necesitan comillas fuera de comillas. */
const SAFE_RE = /^[A-Za-z0-9_@%+=:,./~^-]+$/;

/**
 * Cita solo si hace falta (para comandos que lee una persona): una palabra segura queda tal cual, la
 * cadena vacía es `''` y una ruta `~/…` o `~usuario/…` conserva la expansión de `~`
 * («~/mi carpeta» → `~/'mi carpeta'`).
 */
export function shQuoteMinimal(value: string): string {
  if (value === "") return "''";
  if (SAFE_RE.test(value)) return value;
  const tilde = /^~[A-Za-z0-9_.-]*\//.exec(value);
  if (tilde) return tilde[0] + shQuoteMinimal(value.slice(tilde[0].length));
  return shQuote(value);
}
