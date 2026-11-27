// Qué comando se escribió en la terminal, leído de la pantalla (lo que la shell mostró), no de las teclas:
// así cuentan el tabulador, las flechas del historial y lo editado a mitad de línea. Lógica pura; quien
// mira la terminal es components/Terminal/termRecorder.ts.
//
// Nunca se guarda lo escrito tras un aviso de contraseña, frase de llave, PIN o código: el aviso está en
// la parte de la línea anterior al cursor cuando se empezó a escribir (`prompt`).

/** Avisos que piden un secreto, al final de lo que hay antes del cursor. Mejor de más que de menos. */
const SECRET_PROMPT = /(password|passwd|passphrase|pass phrase|contraseña|clave|frase|passcode|\bpin\b|token|secret|verification code|código|otp)[^\n]{0,80}[:?>]\s*$/i;

/** Más largo que esto no es un aviso (es salida de un programa). */
const MAX_PROMPT_LEN = 300;

/** true si `prompt` (lo que había antes del cursor al empezar a escribir) pide un secreto. */
export function isSecretPrompt(prompt: string): boolean {
  const p = prompt.trim();
  if (!p) return false;
  return SECRET_PROMPT.test(p.slice(-MAX_PROMPT_LEN));
}

/** Comandos tan largos se recortan (los guarda el motor, que también recorta). */
export const MAX_COMMAND_LEN = 2000;

/**
 * El comando de `line` (la línea entera, ya con lo que la shell mostró) sabiendo que `prompt` es lo que
 * había antes del cursor cuando se empezó a escribir. null si no hay nada que guardar: vacío, aviso de
 * contraseña o la pantalla cambió (la línea ya no empieza por el aviso: `clear`, otra salida…).
 */
export function commandFromLine(line: string, prompt: string): string | null {
  if (isSecretPrompt(prompt) || isSecretPrompt(line)) return null;
  if (!line.startsWith(prompt)) return null;
  const cmd = line.slice(prompt.length).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cmd) return null;
  return cmd.length > MAX_COMMAND_LEN ? cmd.slice(0, MAX_COMMAND_LEN) : cmd;
}

/** Teclas que abandonan la línea (Ctrl+C, Ctrl+D, Ctrl+G de la búsqueda inversa). */
export function abandonsLine(data: string): boolean {
  return /[\u0003\u0004\u0007]/.test(data);
}
