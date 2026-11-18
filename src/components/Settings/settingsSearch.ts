// Buscador de la navegación de Ajustes. Sin React, para poder probarlo (settingsSearch.test.ts).

/** Minúsculas y sin tildes, para buscar sin importar cómo se escriba. */
export const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface SearchableSection {
  label: string;
  /** Frase bajo el título de la sección. */
  desc: string;
  /** Palabras extra para el buscador (nombres de los ajustes de la sección). */
  keys: string;
}

/** Grupos con las secciones que coinciden con `query` (sin grupos vacíos). Sin búsqueda, `nav` tal cual. */
export function filterNav<S extends SearchableSection, G extends { items: S[] }>(nav: G[], query: string): G[] {
  const q = fold(query.trim());
  if (!q) return nav;
  return nav
    .map((g) => ({ ...g, items: g.items.filter((s) => fold(`${s.label} ${s.desc} ${s.keys}`).includes(q)) }))
    .filter((g) => g.items.length > 0);
}
