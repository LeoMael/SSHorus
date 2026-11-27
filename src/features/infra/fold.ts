// Listas largas del mapa: si una columna de una banda (servidor + usuario + capa) tiene muchos nodos, se
// enseñan los primeros y el resto va en un nodo «+N puertos». Solo cambia lo que se dibuja: el grafo
// original no se toca. Funciones puras.
import type { Health, InfraGraph, MapEdge, MapNode, NodeKind } from "./graphTypes";

/** Nodos que se ven por columna antes de plegar el resto. */
export const FOLD_LIMIT = 8;
/** Prefijo del id de un nodo plegado: `more|<clave de columna>`. */
export const MORE_PREFIX = "more|";

export interface FoldInfo {
  /** Clave de la columna (para desplegarla). */
  key: string;
  /** Ids de los nodos que esconde. */
  ids: string[];
}

export interface FoldedGraph {
  graph: InfraGraph;
  /** Por id del nodo plegado. */
  folds: Map<string, FoldInfo>;
}

const NOUN: Partial<Record<NodeKind, [string, string]>> = {
  port: ["puerto", "puertos"],
  container: ["contenedor", "contenedores"],
  service: ["servicio", "servicios"],
  process: ["proceso", "procesos"],
  db: ["base de datos", "bases de datos"],
  site: ["sitio", "sitios"],
  system: ["servicio del sistema", "servicios del sistema"],
  external: ["destino externo", "destinos externos"],
};

const SEVERITY: Record<Health, number> = { bad: 0, warn: 1, off: 2, ok: 3 };

export function columnKey(n: Pick<MapNode, "server" | "owner" | "layer">): string {
  return `${n.server}|${n.owner}|${n.layer}`;
}

/** «+12 puertos» (o «+3 elementos» si son de varios tipos). */
export function moreLabel(kinds: NodeKind[]): string {
  const kind = kinds.every((k) => k === kinds[0]) ? kinds[0] : null;
  const noun = (kind && NOUN[kind]) || ["elemento", "elementos"];
  return `+${kinds.length} ${kinds.length === 1 ? noun[0] : noun[1]}`;
}

function worst(hs: Health[]): Health {
  return hs.reduce<Health>((a, h) => (SEVERITY[h] < SEVERITY[a] ? h : a), "ok");
}

/**
 * Pliega las columnas con más de `limit` nodos (salvo las de `expanded`). Se quedan a la vista, por este
 * orden, los que tienen problemas, los que reciben una línea de un nodo visible (así la cadena
 * puerto → contenedor sigue entera) y los primeros; el resto pasa a un nodo «+N». Las líneas de los
 * escondidos se redirigen a ese nodo, sin repetirse.
 */
export function foldGraph(g: InfraGraph, expanded: ReadonlySet<string>, limit = FOLD_LIMIT): FoldedGraph {
  const cols = new Map<string, MapNode[]>();
  for (const n of g.nodes) {
    if (!n.server) continue;
    const k = columnKey(n);
    const c = cols.get(k) ?? [];
    c.push(n);
    cols.set(k, c);
  }
  const incoming = new Map<string, string[]>();
  for (const e of g.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);

  const hiddenTo = new Map<string, string>();
  const folds = new Map<string, FoldInfo>();
  const extra: MapNode[] = [];
  const keys = [...cols.keys()].sort((a, b) => cols.get(a)![0].layer - cols.get(b)![0].layer);
  for (const key of keys) {
    const col = cols.get(key)!;
    // Plegar uno solo no ahorra nada: se pliega a partir de dos.
    if (col.length <= limit + 1 || expanded.has(key)) continue;
    const fedByVisible = (n: MapNode) => (incoming.get(n.id) ?? []).some((f) => !hiddenTo.has(f));
    const rank = (n: MapNode) => (n.health === "bad" || n.health === "warn" ? 0 : fedByVisible(n) ? 1 : 2);
    const order = col.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const hidden = order.slice(limit).map((x) => x.n);
    const id = `${MORE_PREFIX}${key}`;
    for (const n of hidden) hiddenTo.set(n.id, id);
    const first = col[0];
    extra.push({
      id,
      server: first.server,
      owner: first.owner,
      kind: hidden[0].kind,
      layer: first.layer,
      label: moreLabel(hidden.map((n) => n.kind)),
      sub: "Clic para verlos",
      health: worst(hidden.map((n) => n.health)),
      group: null,
      localOnly: hidden.every((n) => n.localOnly),
      details: hidden.map((n) => [n.label, n.sub] as [string, string]),
      nav: null,
    });
    folds.set(id, { key, ids: hidden.map((n) => n.id) });
  }
  if (folds.size === 0) return { graph: g, folds };

  const to = (id: string) => hiddenTo.get(id) ?? id;
  const edges = new Map<string, MapEdge>();
  for (const e of g.edges) {
    const from = to(e.from);
    const dest = to(e.to);
    if (from === dest) continue;
    const touched = from !== e.from || dest !== e.to;
    const id = touched ? `${from}>${dest}` : e.id;
    if (!edges.has(id)) edges.set(id, touched ? { ...e, id, from, to: dest, label: "" } : e);
  }
  return {
    graph: { ...g, nodes: [...g.nodes.filter((n) => !hiddenTo.has(n.id)), ...extra], edges: [...edges.values()] },
    folds,
  };
}
