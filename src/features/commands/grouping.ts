// Cómo se agrupan, cuentan y recorren los comandos de la Biblioteca (funciones puras, sin React).
import { MY_CATEGORY, type CommandItem } from "./state";

export interface CommandGroupData<T extends Pick<CommandItem, "category" | "group">> {
  key: string;
  label: string;
  items: T[];
}

/** Cuántos comandos hay en cada categoría. */
export function countByCategory(items: Pick<CommandItem, "category">[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const it of items) c[it.category] = (c[it.category] ?? 0) + 1;
  return c;
}

/**
 * Agrupa en el orden en que llegan. Buscando, el grupo lleva delante la categoría («Red · Puertos»),
 * así los grupos quedan en el orden de relevancia de su primer comando.
 */
export function groupCommands<T extends Pick<CommandItem, "category" | "group">>(visible: T[], searching: boolean): CommandGroupData<T>[] {
  const out: CommandGroupData<T>[] = [];
  const idx = new Map<string, number>();
  for (const it of visible) {
    const label = searching ? `${it.category === MY_CATEGORY ? "Mis comandos" : it.category} · ${it.group}` : it.group;
    let i = idx.get(label);
    if (i === undefined) {
      i = out.length;
      idx.set(label, i);
      out.push({ key: label, label, items: [] });
    }
    out[i].items.push(it);
  }
  return out;
}

/** id del comando al moverse `delta` puestos desde el elegido (sin dar la vuelta; null si no hay ninguno). */
export function stepSelection(ids: string[], selectedId: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const i = selectedId === null ? -1 : ids.indexOf(selectedId);
  const next = Math.max(0, Math.min(ids.length - 1, i + delta));
  return ids[next];
}
