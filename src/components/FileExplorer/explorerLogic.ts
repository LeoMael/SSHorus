// Reglas del explorador sin React ni DOM: orden y filtro de filas, nombres, historial y búsqueda rápida.
import type { FileEntry } from "../../api/types";
import type { SortState } from "./FileList";
import { isDirLike } from "./icons";

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export function compareEntries(a: FileEntry, b: FileEntry, sort: SortState): number {
  const da = isDirLike(a);
  const db = isDirLike(b);
  if (da !== db) return da ? -1 : 1;
  let r = 0;
  switch (sort.key) {
    case "size":
      r = da ? 0 : a.size - b.size;
      break;
    case "modified":
      r = (a.modified ?? 0) - (b.modified ?? 0);
      break;
    case "permissions":
      r = a.permissionsStr < b.permissionsStr ? -1 : a.permissionsStr > b.permissionsStr ? 1 : 0;
      break;
    default:
      r = collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  if (r === 0 && sort.key !== "name") return collator.compare(a.name, b.name);
  return r * sort.dir;
}

/** Filas que se ven: sin ocultos (si así se pide), filtradas por nombre y ordenadas. */
export function visibleRows(entries: readonly FileEntry[], filter: string, showHidden: boolean, sort: SortState): FileEntry[] {
  const q = filter.trim().toLowerCase();
  const list = entries.filter((e) => (showHidden || !e.name.startsWith(".")) && (!q || e.name.toLowerCase().includes(q)));
  list.sort((a, b) => compareEntries(a, b, sort));
  return list;
}

export function validateName(v: string): string | null {
  const t = v.trim();
  if (!t) return "Escribe un nombre";
  if (t.includes("/")) return "El nombre no puede contener «/»";
  if (t === "." || t === "..") return "Ese nombre no es válido";
  return null;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «nombre» si es uno solo; si no, «N elementos». */
export function itemsLabel(count: number, firstName: string): string {
  return count === 1 ? `«${firstName}»` : plural(count, "elemento", "elementos");
}

/** Bytes de los archivos de la lista (las carpetas no suman). */
export function filesBytes(list: readonly FileEntry[]): number {
  return list.reduce((n, e) => n + (isDirLike(e) ? 0 : e.size), 0);
}

export interface History {
  back: string[];
  fwd: string[];
}

/** Historial tras ir de `prev` a otra carpeta: nueva (push), atrás o adelante. */
export function stepHistory(h: History, mode: "push" | "back" | "forward", prev: string): History {
  if (mode === "push") return { back: [...h.back, prev].slice(-100), fwd: [] };
  if (mode === "back") return { back: h.back.slice(0, -1), fwd: [prev, ...h.fwd] };
  return { back: [...h.back, prev], fwd: h.fwd.slice(1) };
}

/** Rutas entre dos filas (ambas incluidas), en el orden visible. */
export function rangePaths(rows: readonly FileEntry[], a: number, b: number): string[] {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).map((r) => r.path);
}

/** Búsqueda rápida: primera fila (dando la vuelta) cuyo nombre empieza por `text`. Con una sola letra
 *  se busca a partir de la siguiente a `cur` (así repetirla recorre las coincidencias). -1 si no hay. */
export function typeAheadIndex(rows: readonly FileEntry[], cur: number, text: string): number {
  const from = text.length === 1 ? cur + 1 : Math.max(cur, 0);
  for (let k = 0; k < rows.length; k++) {
    const i = (from + k) % rows.length;
    if (rows[i].name.toLowerCase().startsWith(text)) return i;
  }
  return -1;
}
