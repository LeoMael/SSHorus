// ¿La terminal está pidiendo una contraseña? Lógica pura (se prueba en passwordPrompt.test.ts).
// El botón «Escribir la contraseña de sudo» solo la escribe si la línea del cursor es un aviso de
// contraseña: así nunca acaba a la vista o en el historial de la shell.

/** Avisos aceptados, sobre la línea entera (sin espacios a los lados). Anclados al principio: un
 *  `echo Password:` escrito tras el prompt de la shell no cuenta. */
const PROMPTS: RegExp[] = [
  // sudo: «[sudo] password for leo:» / «[sudo] contraseña para leo:»
  /^\[sudo\] (password|contraseña) (for|para) \S.*:$/i,
  // su, passwd, sudo sin prefijo…: «Password:», «Contraseña:», «Password for leo:», «Contraseña para leo:»
  /^(password|contraseña)( (for|para) \S.*)?:$/i,
];

/** Más largo que esto no es un aviso de contraseña. */
const MAX_PROMPT_LEN = 200;

/** true si `line` (la línea donde está el cursor) es un aviso de contraseña. */
export function isPasswordPrompt(line: string): boolean {
  const l = line.trim();
  return l.length > 0 && l.length <= MAX_PROMPT_LEN && PROMPTS.some((re) => re.test(l));
}
