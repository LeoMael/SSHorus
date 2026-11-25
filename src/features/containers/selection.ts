// Selección de filas de una tabla (casillas): marcar una, todas las visibles, ninguna, y olvidar las que
// ya no existen tras recargar. Funciones puras (para `useReducer`).

export type SelAction =
  | { type: "toggle"; key: string }
  /** Marca todas las visibles; si ya lo estaban, las desmarca. */
  | { type: "toggleAll"; keys: string[] }
  | { type: "clear" }
  /** Deja solo las que siguen existiendo. */
  | { type: "retain"; keys: string[] };

export function toggleKey(s: ReadonlySet<string>, key: string): Set<string> {
  const n = new Set(s);
  if (n.has(key)) n.delete(key);
  else n.add(key);
  return n;
}

/** Todas las claves están marcadas (y hay alguna). */
export function allSelected(s: ReadonlySet<string>, keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => s.has(k));
}

/** Hay alguna marcada, pero no todas (casilla «a medias»). */
export function someSelected(s: ReadonlySet<string>, keys: string[]): boolean {
  return keys.some((k) => s.has(k)) && !allSelected(s, keys);
}

export function selectionReducer(s: ReadonlySet<string>, a: SelAction): ReadonlySet<string> {
  switch (a.type) {
    case "toggle":
      return toggleKey(s, a.key);
    case "toggleAll": {
      if (allSelected(s, a.keys)) {
        const n = new Set(s);
        for (const k of a.keys) n.delete(k);
        return n;
      }
      return new Set([...s, ...a.keys]);
    }
    case "clear":
      return s.size ? new Set() : s;
    case "retain": {
      const keep = new Set(a.keys);
      const n = new Set([...s].filter((k) => keep.has(k)));
      return n.size === s.size ? s : n;
    }
  }
}
