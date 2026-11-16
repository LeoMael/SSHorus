// Fuentes de la terminal. Función pura, con pruebas en termText.test.ts.

/** Fuentes de terminal habituales de cada sistema, por si no está ninguna de las elegidas: sin
 *  ellas, `monospace` puede acabar en Courier (fina y borrosa) en macOS. */
const FALLBACK_FONTS = ["Cascadia Mono", "Consolas", "SF Mono", "Menlo", "DejaVu Sans Mono", "Liberation Mono"];
const GENERIC = /^(ui-)?monospace$/i;

/** Lista de fuentes para xterm.js: la del usuario y detrás las de reserva, acabando en `monospace`. */
export function terminalFontStack(family: string): string {
  const parts = family
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !GENERIC.test(p));
  const have = new Set(parts.map((p) => p.replace(/^['"]|['"]$/g, "").toLowerCase()));
  const extra = FALLBACK_FONTS.filter((f) => !have.has(f.toLowerCase())).map((f) => (f.includes(" ") ? `"${f}"` : f));
  return [...parts, ...extra, "monospace"].join(", ");
}
