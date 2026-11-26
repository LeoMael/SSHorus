// Contraseñas aleatorias (usuarios nuevos de Administración, bases de datos de Contenedores…).

const PASS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASS_SYMBOLS = "-_.+=@%";

/** Contraseña aleatoria segura (crypto.getRandomValues, sin sesgo de módulo). */
export function generatePassword(length = 20): string {
  const alphabet = PASS_ALPHABET + PASS_SYMBOLS;
  const out: string[] = [];
  const buf = new Uint8Array(1);
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) out.push(alphabet[buf[0] % alphabet.length]);
  }
  // Garantiza al menos un número y un símbolo (algunas políticas los exigen).
  if (!/[0-9]/.test(out.join(""))) out[1] = "7";
  if (!/[-_.+=@%]/.test(out.join(""))) out[length - 2] = "-";
  return out.join("");
}
