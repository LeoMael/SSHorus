// Salida de los scripts de lectura dividida en secciones. Cada script marca el inicio de una sección
// con una línea propia (`@@nombre` casi siempre); lo que va antes de la primera marca se ignora.
// Funciones puras, sin React ni Tauri.

/** Reconoce una línea de marca y devuelve el nombre de la sección, o null si es una línea normal. */
export type SectionHeader = (line: string) => string | null;

/** Formatos de marca que usan los scripts. */
export const SECTION_HEADERS = {
  /** `@@nombre` en minúsculas, la línea entera. Es el formato de casi todos los scripts. */
  exact: (line) => /^@@([a-z]+)$/.exec(line)?.[1] ?? null,
  /** Cualquier línea que empiece por `@@`; el nombre es el resto (`@@ct=docker` → `ct=docker`). */
  prefix: (line) => (line.startsWith("@@") ? line.slice(2).trim() : null),
  /** Cualquier línea que empiece por `@@`; el nombre llega hasta el primer `=` (`@@self=12` → `self`). */
  key: (line) => {
    if (!line.startsWith("@@")) return null;
    const eq = line.indexOf("=");
    return (eq > 0 ? line.slice(2, eq) : line.slice(2)).trim();
  },
  /** `@@TV:nombre@@` («Analizar servidor», que vuelca archivos enteros); admite espacios alrededor. */
  tv: (line) => /^@@TV:([a-z]+)@@$/.exec(line.trim())?.[1] ?? null,
} satisfies Record<string, SectionHeader>;

export interface SplitSectionsOptions {
  /** Formato de la marca (por defecto `exact`). */
  header?: keyof typeof SECTION_HEADERS | SectionHeader;
  /**
   * Líneas vacías dentro de una sección:
   * - `drop` (por defecto): se quitan las vacías («»);
   * - `dropBlank`: se quitan también las que solo tienen espacios;
   * - `keep`: se conservan todas (para numerar las líneas de un archivo);
   * - `trimEnd`: se conservan, salvo las que quedan en blanco al final de cada sección.
   */
  blank?: "drop" | "dropBlank" | "keep" | "trimEnd";
  /** Si una sección se repite: `replace` (por defecto) empieza de cero; `append` sigue añadiendo. */
  repeat?: "replace" | "append";
}

/** Separa la salida en secciones. Las líneas llegan sin el `\r` final. */
export function splitSections(stdout: string, opts: SplitSectionsOptions = {}): Map<string, string[]> {
  const header = typeof opts.header === "function" ? opts.header : SECTION_HEADERS[opts.header ?? "exact"];
  const blank = opts.blank ?? "drop";
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const name = header(line);
    if (name !== null) {
      cur = (opts.repeat === "append" ? out.get(name) : undefined) ?? [];
      out.set(name, cur);
      continue;
    }
    if (!cur) continue;
    if (blank === "drop" && line === "") continue;
    if (blank === "dropBlank" && line.trim() === "") continue;
    cur.push(line);
  }
  if (blank === "trimEnd") {
    for (const v of out.values()) while (v.length && !v[v.length - 1].trim()) v.pop();
  }
  return out;
}
