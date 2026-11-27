// Estado de cada nodo del mapa en palabras (no solo con color): «Activo», «Parado», «Expuesto»…
// y recorte de etiquetas al ancho de la tarjeta. Funciones puras.
import type { Health, MapNode, MapServer, NodeKind } from "./graphTypes";

const GENERIC: Record<Health, string> = { ok: "Bien", warn: "Aviso", bad: "Caído o con error", off: "Parado o sin datos" };
const RUNNING: Record<Health, string> = { ok: "Activo", warn: "Con avisos", bad: "Con error", off: "Parado" };

/** Textos por tipo de nodo (lo que no está aquí usa los genéricos). */
const BY_KIND: Partial<Record<NodeKind, Partial<Record<Health, string>>>> = {
  container: RUNNING,
  service: RUNNING,
  process: { ...RUNNING, warn: "Sin permiso para ver el proceso" },
  proxy: RUNNING,
  db: RUNNING,
  system: RUNNING,
  firewall: { ok: "Activo", warn: "Instalado pero apagado", off: "Estado desconocido" },
  port: { ok: "Expuesto: se puede llegar desde fuera" },
  site: { ok: "Bien", warn: "El certificado caduca pronto", bad: "Certificado caducado o a punto" },
  external: { bad: "Nada escucha en ese destino" },
};

export function nodeStatusText(kind: NodeKind, health: Health): string {
  return BY_KIND[kind]?.[health] ?? GENERIC[health];
}

export function nodeStatus(n: Pick<MapNode, "kind" | "health">): { health: Health; text: string } {
  return { health: n.health, text: nodeStatusText(n.kind, n.health) };
}

const SERVER_TEXT: Record<Health, string> = { ok: "", warn: "con avisos", bad: "error al leer", off: "sin conexión" };

/** Lo que se escribe junto al nombre del servidor (vacío si está bien). */
export function serverStatusText(s: Pick<MapServer, "health">): string {
  return SERVER_TEXT[s.health];
}

/**
 * Recorta `text` con «…» para que quepa en `max` píxeles según `measure` (ancho de un texto). Busca el
 * corte más largo que cabe (búsqueda binaria: `measure` puede ser caro).
 */
export function fitText(text: string, max: number, measure: (s: string) => number): string {
  if (measure(text) <= max) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`) <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}
