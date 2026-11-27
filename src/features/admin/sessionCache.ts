// Lecturas de Administración guardadas por clave (sesión, o sesión + usuario): al volver a la
// sub-pestaña se ven al instante y, si se lanzan dos lecturas seguidas, solo cuenta la última.
// La usan Servicios, Paquetes y Tareas programadas.
import { create } from "zustand";
import { errorMessage } from "../../api/core";

export interface CacheEntry<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** ms desde epoch de la última lectura buena (0 = nunca). */
  at: number;
}

export interface SessionCache<T> {
  useEntry: (key: string) => CacheEntry<T>;
  get: (key: string) => CacheEntry<T>;
  /** Lee (o vuelve a leer) y lo guarda. */
  load: (key: string, read: () => Promise<T>) => Promise<void>;
}

export function sessionCache<T>(): SessionCache<T> {
  const EMPTY: CacheEntry<T> = { data: null, loading: false, error: null, at: 0 };
  const store = create<{ by: Record<string, CacheEntry<T>> }>(() => ({ by: {} }));
  const gens = new Map<string, number>();
  const patch = (key: string, p: Partial<CacheEntry<T>>) =>
    store.setState((s) => ({ by: { ...s.by, [key]: { ...(s.by[key] ?? EMPTY), ...p } } }));
  return {
    useEntry: (key) => store((s) => s.by[key] ?? EMPTY),
    get: (key) => store.getState().by[key] ?? EMPTY,
    load: async (key, read) => {
      const g = (gens.get(key) ?? 0) + 1;
      gens.set(key, g);
      patch(key, { loading: true, error: null });
      try {
        const data = await read();
        if (gens.get(key) === g) patch(key, { data, loading: false, at: Date.now() });
      } catch (e) {
        if (gens.get(key) === g) patch(key, { loading: false, error: errorMessage(e) });
      }
    },
  };
}
