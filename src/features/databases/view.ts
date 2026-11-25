// Textos y filtros de la pestaña «Bases de datos». Funciones puras.
import type { DbTable, DbTableKind, DbTarget } from "./types";

export const KIND_LABEL: Record<DbTableKind, string> = {
  table: "tabla",
  view: "vista",
  matview: "vista materializada",
  foreign: "tabla externa",
  partitioned: "tabla con particiones",
};

/** «≈ 1.234 filas» (las estadísticas son aproximadas); null si no hay dato. */
export function rowsText(rows: number | null): string | null {
  if (rows === null) return null;
  return `≈ ${rows.toLocaleString("es")} ${rows === 1 ? "fila" : "filas"}`;
}

/**
 * Tablas que coinciden con la búsqueda: por nombre (o «esquema.tabla»), por columna o por comentario.
 * Las que coinciden por nombre van primero.
 */
export function filterTables(tables: DbTable[], query: string): DbTable[] {
  const q = query.trim().toLowerCase();
  if (!q) return tables;
  const byName: DbTable[] = [];
  const other: DbTable[] = [];
  for (const t of tables) {
    if (`${t.schema}.${t.name}`.toLowerCase().includes(q)) byName.push(t);
    else if (t.columns.some((c) => c.name.toLowerCase().includes(q)) || t.comment.toLowerCase().includes(q)) other.push(t);
  }
  return [...byName, ...other];
}

/** Las tablas relacionadas con las elegidas (para el diagrama de una búsqueda): las que apuntan y a las que apuntan. */
export function withNeighbors(all: DbTable[], picked: DbTable[]): DbTable[] {
  const id = (t: Pick<DbTable, "schema" | "name">) => `${t.schema}.${t.name}`;
  const chosen = new Set(picked.map(id));
  const keep = new Set(chosen);
  for (const t of all) {
    for (const fk of t.foreignKeys) {
      const to = `${fk.refSchema}.${fk.refTable}`;
      if (chosen.has(id(t)) || chosen.has(to)) {
        keep.add(id(t));
        keep.add(to);
      }
    }
  }
  return all.filter((t) => keep.has(id(t)));
}

export interface TargetGroup {
  title: string;
  targets: DbTarget[];
}

/** Lista agrupada: en el servidor, en contenedores y archivos SQLite. */
export function groupTargets(targets: DbTarget[]): TargetGroup[] {
  const groups: TargetGroup[] = [
    { title: "En el servidor", targets: targets.filter((t) => t.place.kind === "host") },
    { title: "En contenedores", targets: targets.filter((t) => t.place.kind === "container") },
    { title: "Archivos SQLite", targets: targets.filter((t) => t.place.kind === "file") },
  ];
  return groups.filter((g) => g.targets.length > 0);
}
