// Mapas ya leídos, en memoria y por servidor (sesión) o proyecto: al volver al mapa se ven al instante.
// Además recuerda la vista (zoom y posición) y el estado del lienzo (selección, filtros) de cada uno.
// La lectura sigue aunque el usuario se vaya a otra sección: el resultado queda guardado.
import { create } from "zustand";
import type { ServerSnapshot } from "./graph";
import { staleKeys, type Stamp } from "./freshness";
import type { Viewport } from "./viewport";

export interface CachedMap extends Stamp {
  snapshots: ServerSnapshot[];
}

interface MapCacheState {
  entries: Record<string, CachedMap>;
  /** Claves con una lectura en marcha. */
  loading: Record<string, true>;
}

export const useMapCache = create<MapCacheState>(() => ({ entries: {}, loading: {} }));

const inflight = new Map<string, { token: string; gen: number }>();
let gen = 0;

function setLoading(key: string, on: boolean): void {
  useMapCache.setState((s) => {
    const loading = { ...s.loading };
    if (on) loading[key] = true;
    else delete loading[key];
    return { loading };
  });
}

/**
 * Lee el mapa `key` y lo guarda. Sin `force`, no repite una lectura que ya está en marcha con la
 * misma conexión; con `force` (botón «Actualizar») empieza otra y la anterior se descarta.
 */
export async function fetchMap(key: string, token: string, load: () => Promise<ServerSnapshot[]>, force: boolean): Promise<void> {
  const cur = inflight.get(key);
  if (cur && cur.token === token && !force) return;
  const g = ++gen;
  inflight.set(key, { token, gen: g });
  setLoading(key, true);
  try {
    const snapshots = await load();
    if (inflight.get(key)?.gen !== g) return;
    useMapCache.setState((s) => {
      const entries = { ...s.entries, [key]: { snapshots, at: Date.now(), token } };
      for (const k of staleKeys(entries, key)) forget(entries, k);
      return { entries };
    });
  } finally {
    if (inflight.get(key)?.gen === g) {
      inflight.delete(key);
      setLoading(key, false);
    }
  }
}

function forget(entries: Record<string, CachedMap>, key: string): void {
  delete entries[key];
  views.delete(key);
  canvases.delete(key);
}

// ───────── Estado del lienzo al salir (no reactivo: solo se lee al volver a montarlo) ─────────

export interface SavedView {
  view: Viewport;
  /** El usuario movió la vista (no reajustar sola). */
  touched: boolean;
  /** Filtros con los que se ajustó (si cambian, se vuelve a ajustar). */
  refitKey: string;
}

export interface SavedCanvas {
  selected: string | null;
  hideLocal: boolean;
  hideSystem: boolean;
  owners: string[] | null;
  miniOn: boolean;
}

const views = new Map<string, SavedView>();
const canvases = new Map<string, SavedCanvas>();

export const savedView = (key: string): SavedView | null => views.get(key) ?? null;
export const saveView = (key: string, v: SavedView): void => void views.set(key, v);
export const savedCanvas = (key: string): SavedCanvas | null => canvases.get(key) ?? null;
export const saveCanvas = (key: string, c: SavedCanvas): void => void canvases.set(key, c);
