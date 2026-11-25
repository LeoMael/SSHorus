// Diagrama sencillo de relaciones: cada tabla es una caja con sus primeras columnas y cada clave foránea
// una flecha hacia la tabla a la que apunta. Funciones puras (posiciones y trazos para el SVG).
//
// Colocación: las tablas relacionadas van seguidas (recorrido por sus claves foráneas, empezando por las
// que más relaciones tienen) y se reparten en columnas, cada caja en la columna más baja (como un muro de
// ladrillos). Es básico a propósito: con muchas tablas hay que filtrar con la búsqueda.
import type { DbColumn, DbTable } from "./types";

export const BOX_W = 210;
export const HEAD_H = 26;
export const ROW_H = 18;
const PAD_B = 6;
const GAP_X = 56;
const GAP_Y = 28;
const MARGIN = 16;
/** Columnas visibles por caja (el resto se resume en «+N más»). */
export const MAX_ROWS = 10;
/** Más tablas que esto no se dibujan (no se leería nada). */
export const MAX_TABLES = 80;

export const tableId = (t: Pick<DbTable, "schema" | "name">) => `${t.schema}.${t.name}`;

export interface DiagramBox {
  id: string;
  table: DbTable;
  x: number;
  y: number;
  w: number;
  h: number;
  cols: DbColumn[];
  /** Columnas que no caben. */
  hidden: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  path: string;
  /** «cliente_id → id». */
  label: string;
}

export interface Diagram {
  width: number;
  height: number;
  boxes: DiagramBox[];
  edges: DiagramEdge[];
}

function boxHeight(t: DbTable): number {
  const rows = Math.min(t.columns.length, MAX_ROWS) + (t.columns.length > MAX_ROWS ? 1 : 0);
  return HEAD_H + Math.max(rows, 1) * ROW_H + PAD_B;
}

/** Orden: por grupos conectados, empezando por la tabla con más relaciones de cada grupo. */
function order(tables: DbTable[]): DbTable[] {
  const ids = new Set(tables.map(tableId));
  const links = new Map<string, Set<string>>(tables.map((t) => [tableId(t), new Set<string>()]));
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      const to = `${fk.refSchema}.${fk.refTable}`;
      if (!ids.has(to) || to === tableId(t)) continue;
      links.get(tableId(t))?.add(to);
      links.get(to)?.add(tableId(t));
    }
  }
  const byId = new Map(tables.map((t) => [tableId(t), t]));
  const degree = (id: string) => links.get(id)?.size ?? 0;
  const starts = [...tables].sort((a, b) => degree(tableId(b)) - degree(tableId(a)) || tableId(a).localeCompare(tableId(b)));
  const seen = new Set<string>();
  const out: DbTable[] = [];
  for (const s of starts) {
    const queue = [tableId(s)];
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(byId.get(id) as DbTable);
      queue.push(...[...(links.get(id) ?? [])].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b)));
    }
  }
  return out;
}

/** Altura (dentro de la caja) de la fila de una columna; la cabecera si no se ve. */
function rowY(b: DiagramBox, column: string): number {
  const i = b.cols.findIndex((c) => c.name === column);
  return b.y + (i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2);
}

function edgePath(a: DiagramBox, b: DiagramBox, y1: number, y2: number): string {
  if (a.id === b.id) {
    const x = a.x + a.w;
    return `M ${x} ${y1} C ${x + 40} ${y1}, ${x + 40} ${y2 - 24}, ${x} ${y2 - 4}`;
  }
  let x1: number;
  let x2: number;
  let d: number;
  if (b.x >= a.x + a.w) [x1, x2, d] = [a.x + a.w, b.x, 1];
  else if (b.x + b.w <= a.x) [x1, x2, d] = [a.x, b.x + b.w, -1];
  else {
    // Misma columna: por la derecha, con una curva.
    const x = Math.max(a.x + a.w, b.x + b.w);
    return `M ${x} ${y1} C ${x + 48} ${y1}, ${x + 48} ${y2}, ${x} ${y2}`;
  }
  const k = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + d * k} ${y1}, ${x2 - d * k} ${y2}, ${x2} ${y2}`;
}

export function layoutDiagram(tables: DbTable[]): Diagram {
  const list = order(tables.slice(0, MAX_TABLES));
  const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(list.length * 1.4))));
  const heights = new Array<number>(cols).fill(MARGIN);
  const boxes: DiagramBox[] = [];
  for (const t of list) {
    const c = heights.indexOf(Math.min(...heights));
    const h = boxHeight(t);
    boxes.push({ id: tableId(t), table: t, x: MARGIN + c * (BOX_W + GAP_X), y: heights[c], w: BOX_W, h, cols: t.columns.slice(0, MAX_ROWS), hidden: Math.max(0, t.columns.length - MAX_ROWS) });
    heights[c] += h + GAP_Y;
  }
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const edges: DiagramEdge[] = [];
  for (const a of boxes) {
    for (const fk of a.table.foreignKeys) {
      const b = byId.get(`${fk.refSchema}.${fk.refTable}`);
      if (!b) continue;
      const y1 = rowY(a, fk.columns[0] ?? "");
      const y2 = rowY(b, fk.refColumns[0] ?? "");
      edges.push({ id: `${a.id}:${fk.name}`, from: a.id, to: b.id, path: edgePath(a, b, y1, y2), label: `${fk.columns.join(", ")} → ${fk.refColumns.join(", ")}` });
    }
  }
  const used = heights.filter((h) => h > MARGIN).length || 1;
  return {
    width: MARGIN * 2 + used * BOX_W + (used - 1) * GAP_X + 48,
    height: Math.max(...heights) - GAP_Y + MARGIN,
    boxes,
    edges,
  };
}
