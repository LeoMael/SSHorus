// Lectura del texto de /etc/os-release (o /usr/lib/os-release). Función pura, sin React ni Tauri.

/**
 * Pares `CLAVE=valor` de os-release (`ID`, `ID_LIKE`, `PRETTY_NAME`…), sin las comillas que rodean el
 * valor. Las líneas que no tienen esa forma (comentarios, vacías) se ignoran; si una clave se repite,
 * gana la última.
 */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
