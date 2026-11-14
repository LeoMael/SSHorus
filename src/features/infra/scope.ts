// Mapa de infraestructura: «Lo mío» o «Todo el servidor». Funciones puras.
// Sin sudo, un usuario normal ve también lo de root y de otros usuarios (solo lectura) y eso confunde:
// «Lo mío» deja solo lo suyo y, en gris, el camino desde Internet hasta ello; el resto se pliega en «Otros».
import type { InfraGraph, MapNode, NodeKind, ServerSnapshot } from "./graph";
import { NO_SUDO_NOTE, ROUTE_OWNER } from "./owner";

export type MapScope = "mine" | "all";

/** Lo de otros que se muestra en «Lo mío» si lleva desde Internet hasta algo del usuario. */
const ROUTE_KINDS = new Set<NodeKind>(["internet", "firewall", "port", "proxy", "site"]);
/** No cuentan como «servicios» en la caja de «Otros». */
const NOT_SERVICES = new Set<NodeKind>(["internet", "firewall", "port"]);

type ScopeInfo = Pick<ServerSnapshot, "me" | "elevated" | "canSudo">;

/** Tiene sentido separar «lo mío»: hay un usuario conectado y no es root. */
export function canScope(s: Pick<ServerSnapshot, "me">): boolean {
  return !!s.me && s.me !== "root";
}

/** «Todo el servidor» para root o con sudo; «Lo mío» para un usuario normal. */
export function defaultScope(s: ScopeInfo): MapScope {
  return !canScope(s) || s.elevated || s.canSudo ? "all" : "mine";
}

/** Alcance de cada servidor que se puede separar: el elegido (se recuerda por servidor) o el de por defecto. */
export function serverScopes(snaps: ServerSnapshot[], chosen: Record<string, MapScope>): Map<string, MapScope> {
  const out = new Map<string, MapScope>();
  for (const s of snaps) if (canScope(s) && !s.offline && !s.error) out.set(s.id, chosen[s.id] ?? defaultScope(s));
  return out;
}

/** Servidores en «Lo mío» → su usuario conectado. */
export function mineUsers(snaps: ServerSnapshot[], scopes: Map<string, MapScope>): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of snaps) if (scopes.get(s.id) === "mine" && s.me) out.set(s.id, s.me);
  return out;
}

/**
 * Deja en cada servidor de `mine` (id → usuario) solo lo del usuario y el camino desde Internet hasta ello
 * (cortafuegos, puerto, proxy y sitio de otros, con dueño ROUTE_OWNER). Lo demás no se dibuja: se cuenta
 * en `hidden` del servidor. Los servidores que no están en `mine` quedan igual.
 */
export function scopeGraph(g: InfraGraph, mine: Map<string, string>): InfraGraph {
  if (mine.size === 0) return g;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const e of g.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);

  const keep = new Map<string, MapNode>();
  for (const n of g.nodes) if (!n.server || !mine.has(n.server)) keep.set(n.id, n);
  for (const [sid, me] of mine) {
    const stack: string[] = [];
    for (const n of g.nodes) {
      if (n.server !== sid || n.owner !== me) continue;
      keep.set(n.id, n);
      stack.push(n.id);
    }
    // Hacia atrás desde lo suyo: sitio ← proxy ← puerto ← cortafuegos ← Internet (del mismo servidor).
    while (stack.length) {
      for (const from of incoming.get(stack.pop()!) ?? []) {
        const p = byId.get(from);
        if (!p || keep.has(from) || !ROUTE_KINDS.has(p.kind) || p.server !== sid) continue;
        keep.set(from, { ...p, owner: ROUTE_OWNER });
        stack.push(from);
      }
    }
  }

  const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  if (!edges.some((e) => e.from === "internet")) keep.delete("internet");
  const nodes = g.nodes.filter((n) => keep.has(n.id)).map((n) => keep.get(n.id)!);
  const servers = g.servers.map((s) => {
    const me = mine.get(s.id);
    if (me === undefined) return s;
    const shown = nodes.filter((n) => n.server === s.id);
    const owners = [ROUTE_OWNER, me].filter((o) => shown.some((n) => n.owner === o));
    const hidden = g.nodes.filter((n) => n.server === s.id && !keep.has(n.id) && !NOT_SERVICES.has(n.kind)).length;
    return { ...s, owners, hidden };
  });
  return { servers, nodes, edges };
}

/** Texto de la caja plegada (sin el enlace «Ver todo»). */
export function othersText(n: number): string {
  return `Otros: ${n} ${n === 1 ? "servicio" : "servicios"} del sistema y de otros usuarios`;
}

const NOTES = {
  mineSudo: "Ves solo lo tuyo.",
  mineOpen: "Ves solo lo tuyo. Este servidor deja a cualquier usuario ver los procesos de otros (solo lectura); con sudo podrías verlo todo con detalle.",
  mineClosed: "Ves solo lo tuyo. Con sudo podrías ver también lo del sistema y de otros usuarios.",
  allNoSudo: "Puedes verlo, pero no cambiarlo: es de root o de otros usuarios.",
  allSudoUnused: "Sin la contraseña de sudo se ve con menos detalle lo de root y de otros usuarios.",
} as const;

/** Frase que explica lo que se ve en un servidor (null = nada que aclarar). */
export function scopeNote(scope: MapScope | undefined, s: ScopeInfo & { othersVisible?: boolean | null }): string | null {
  if (!scope) return null;
  if (scope === "mine") return s.elevated ? NOTES.mineSudo : s.othersVisible === false ? NOTES.mineClosed : NOTES.mineOpen;
  if (s.elevated) return null;
  return s.canSudo ? NOTES.allSudoUnused : NOTES.allNoSudo;
}

/**
 * Avisos del mapa: `scope` (qué se ve, uno por servidor) y `other` (errores y avisos de la lectura). La
 * frase de alcance sustituye al aviso genérico de «sin sudo».
 */
export function mapNotes(snaps: ServerSnapshot[], scopes: Map<string, MapScope>): { scope: string[]; other: string[] } {
  const named = (s: ServerSnapshot, t: string) => (snaps.length > 1 ? `${s.name}: ${t}` : t);
  const scope: string[] = [];
  const other: string[] = [];
  for (const s of snaps) {
    const sc = scopes.get(s.id);
    const note = scopeNote(sc, { ...s, othersVisible: s.extra?.othersVisible });
    if (note) scope.push(named(s, note));
    if (s.error) other.push(`${s.name}: ${s.error}`);
    for (const n of s.notes) if (!(sc && n === NO_SUDO_NOTE)) other.push(named(s, n));
  }
  return { scope, other };
}
