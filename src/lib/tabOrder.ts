// Orden de la barra de pestañas: grupos seguidos (servidor, este equipo, paneles) que se reordenan
// cada uno por su lado. Funciones puras, con pruebas en tabOrder.test.ts.

/** Mueve el elemento `id` a la posición `toIndex` (acotada). Si no está, devuelve la misma lista. */
export function moveById<T extends { id: string }>(list: T[], id: string, toIndex: number): T[] {
  const from = list.findIndex((t) => t.id === id);
  if (from < 0 || from === toIndex) return list;
  const out = [...list];
  const [t] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(toIndex, out.length)), 0, t);
  return out;
}

/**
 * Al arrastrar `id` sobre la pestaña `target` (índice en toda la barra): grupo y posición dentro de él.
 * null si `target` cae en otro grupo (no se mezclan) o si `id` no está.
 */
export function slotInGroup(groups: readonly (readonly string[])[], id: string, target: number): { group: number; index: number } | null {
  let start = 0;
  for (let g = 0; g < groups.length; g++) {
    const ids = groups[g];
    if (ids.includes(id)) {
      const index = target - start;
      return index >= 0 && index < ids.length ? { group: g, index } : null;
    }
    start += ids.length;
  }
  return null;
}
