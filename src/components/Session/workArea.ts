// Reglas del área de trabajo de un servidor (sin React ni DOM): qué archivo se ve, en qué modo,
// cómo se reordenan las pestañas y el reparto guardado de los paneles.
import type { Layout } from "react-resizable-panels";
import type { WorkMode } from "./sessionNav";

/** Archivo que se ve: el elegido si sigue en esta ventana; si se fue a otra, el más cercano a su
 *  izquierda (o el primero). `attached` son los de `files` que no están en otra ventana. */
export function currentFile(
  activeFile: string | null,
  attached: readonly string[],
  files: readonly string[],
  detached: ReadonlySet<string>,
): string | null {
  if (activeFile && attached.includes(activeFile)) return activeFile;
  if (attached.length === 0) return null;
  const i = activeFile ? files.indexOf(activeFile) : -1;
  for (let k = i - 1; k >= 0; k--) if (!detached.has(files[k])) return files[k];
  return attached[0];
}

/** Modo del área: sin archivo solo hay vista fija; si no, dividida o la pestaña elegida. */
export function workMode(current: string | null, split: boolean, focus: "fixed" | "file"): WorkMode {
  return current ? (split ? "split" : focus === "file" ? "editors" : "side") : "side";
}

/** Archivo que pasa a verse al cerrar `path`: el de su izquierda, o el primero; null si no queda ninguno. */
export function neighborAfterClose(attached: readonly string[], path: string): string | null {
  const idx = attached.indexOf(path);
  const next = attached.filter((p) => p !== path);
  return idx > 0 ? next[idx - 1] : (next[0] ?? null);
}

/** Mueve `item` al sitio de `target` (los demás se corren). Sin alguno de los dos, la lista tal cual. */
export function moveItem(list: string[], item: string, target: string): string[] {
  const from = list.indexOf(item);
  const to = list.indexOf(target);
  if (from < 0 || to < 0) return list;
  const n = list.slice();
  n.splice(from, 1);
  n.splice(to, 0, item);
  return n;
}

/** Reparto guardado entre área de trabajo y terminal (layout «session»). */
export function initialLayout(saved: number[] | undefined): Layout {
  if (saved && saved.length === 2 && saved.every((n) => Number.isFinite(n) && n > 5)) {
    return { work: saved[0], terminal: saved[1] };
  }
  return { work: 58, terminal: 42 };
}

/** Reparto guardado entre la vista fija y los editores (layout «sessionSplit»). */
export function splitLayout(saved: number[] | undefined): Layout {
  if (saved && saved.length === 2 && saved.every((n) => Number.isFinite(n) && n >= 10 && n <= 90)) {
    return { side: saved[0], editors: saved[1] };
  }
  return { side: 38, editors: 62 };
}
