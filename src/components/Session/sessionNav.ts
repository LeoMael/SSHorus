// Moverse y cerrar dentro de una pestaña de servidor (lógica pura, sin React ni DOM).
// La fila del área de trabajo tiene vistas fijas (Archivos, Comandos…) y archivos abiertos.

/** side: se ve una vista fija · editors: se ve un archivo · split: vista fija | editores, lado a lado. */
export type WorkMode = "side" | "split" | "editors";

/** Dónde está el foco: terminal, vista fija, editores u otra parte de la ventana. */
export type WorkZone = "terminal" | "side" | "editors" | "other";

/** Elemento siguiente (dir 1) o anterior (-1), dando la vuelta; sin el actual, el primero o el último. */
export function stepItem<T>(items: readonly T[], cur: T | null, dir: 1 | -1): T | null {
  if (items.length === 0) return null;
  const i = cur === null ? -1 : items.indexOf(cur);
  if (i < 0) return dir === 1 ? items[0] : items[items.length - 1];
  return items[(i + dir + items.length) % items.length];
}

/** Secciones que recorre «Sección siguiente/anterior»: la fila entera; al dividir, solo las vistas fijas
 *  (los archivos se ven a la derecha y tienen su propio atajo). */
export function sectionItems(fixed: readonly string[], files: readonly string[], mode: WorkMode): string[] {
  return mode === "split" ? [...fixed] : [...fixed, ...files];
}

/** Sección que se ve ahora (la elegida en la fila). */
export function currentSection(mode: WorkMode, side: string, file: string | null): string {
  return mode === "editors" && file ? file : side;
}

/** Archivo al que lleva «Archivo siguiente/anterior». Desde una vista fija, vuelve al último archivo. */
export function fileStep(files: readonly string[], current: string | null, mode: WorkMode, dir: 1 | -1): string | null {
  if (files.length === 0) return null;
  if (mode === "side") return current && files.includes(current) ? current : files[0];
  return stepItem(files, current, dir);
}

/** Archivo que cierra Ctrl+W: el que se ve y tiene el foco. Las vistas fijas no se cierran y la terminal
 *  es de la shell; si no hay nada que cerrar, null (no se cierra la conexión). */
export function closeTarget(mode: WorkMode, current: string | null, zone: WorkZone): string | null {
  if (!current || zone === "terminal" || mode === "side") return null;
  if (mode === "split" && zone === "side") return null;
  return current;
}
