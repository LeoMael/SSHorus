// «Limpiar sin usar» de Imágenes, Volúmenes y Redes: qué se borraría, un comando por dueño (con «Todos»,
// cada usuario limpia lo suyo) y por qué el botón está desactivado. Funciones puras.
import { pruneNetworks, pruneVolumes } from "./commands";
import { ownedBy, splitByOwner, withOwner } from "./owner";
import type { Cmd } from "./shell";
import type { Container, Engine, NetworkInfo, VolumeInfo } from "./types";

/**
 * El mismo comando de limpieza una vez por cada dueño que tiene algo que limpiar. Con un solo dueño, sin
 * marcar (va como el elegido arriba); sin nada que limpiar, ningún comando (el diálogo no deja ejecutar).
 */
export function pruneCmdsByOwner<T extends { owner?: string }>(candidates: T[], cmd: Cmd): Cmd[] {
  return splitByOwner(candidates, "").map(([owner]) => withOwner(cmd, owner || undefined));
}

/** Textos de «por qué está desactivado» de cada pestaña (en minúscula, tras «… porque»). */
export interface PruneTexts {
  /** «las imágenes», «los volúmenes»… */
  what: string;
  /** No hay ninguno que se pueda limpiar (ni en uso ni sin usar). */
  none: string;
  /** Todos los usa algún contenedor. */
  allUsed: string;
}

export interface PruneState {
  loaded: boolean;
  error: string | null;
  /** Cuántos hay que se podrían limpiar si nadie los usara. */
  total: number;
  /** Cuántos se borrarían ahora. */
  candidates: number;
}

/** Por qué «Limpiar sin usar» está desactivado (null = se puede). */
export function pruneBlocked(s: PruneState, t: PruneTexts): string | null {
  if (!s.loaded) return s.error ? `no se pudieron leer ${t.what} (mira el error de arriba)` : `todavía se están leyendo ${t.what}`;
  if (s.total === 0) return t.none;
  if (s.candidates === 0) return t.allUsed;
  return null;
}

// ───────── Volúmenes ─────────

/** Volúmenes que borraría `volume prune`. Docker 23+ sin `-a` solo borra los anónimos. */
export function volumePruneCandidates(vols: VolumeInfo[], engine: Engine, all: boolean): VolumeInfo[] {
  return vols.filter((v) => v.unused && (engine !== "docker" || all || v.anonymous));
}

export function pruneVolumesCmds(vols: VolumeInfo[], engine: Engine, all: boolean): Cmd[] {
  return pruneCmdsByOwner(volumePruneCandidates(vols, engine, all), pruneVolumes(engine, all));
}

export const VOLUME_PRUNE_TEXTS: PruneTexts = {
  what: "los volúmenes",
  none: "no hay volúmenes en el servidor",
  allUsed: "todos los volúmenes los usa algún contenedor (también los parados)",
};

// ───────── Redes ─────────

/** Contenedores conectados a la red (según la lista de `ps`), del mismo dueño. */
export function membersOf(n: NetworkInfo, containers: Container[]): Container[] {
  return ownedBy(containers, n.owner).filter((c) => c.networks.includes(n.name));
}

/** Redes que borraría `network prune`: las no integradas sin ningún contenedor (ni parado). */
export function unusedNetworks(nets: NetworkInfo[], containers: Container[]): NetworkInfo[] {
  return nets.filter((n) => !n.builtin && membersOf(n, containers).length === 0);
}

export function pruneNetworksCmds(nets: NetworkInfo[], containers: Container[], engine: Engine): Cmd[] {
  return pruneCmdsByOwner(unusedNetworks(nets, containers), pruneNetworks(engine));
}

export const NETWORK_PRUNE_TEXTS: PruneTexts = {
  what: "las redes",
  none: "solo están las redes integradas, que no se borran",
  allUsed: "todas las redes las usa algún contenedor (también los parados)",
};
