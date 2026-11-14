// Datos de un mapa con caché: al volver se ve lo guardado al instante. Se relee solo con «Actualizar»,
// al reconectar (cambia `token`) o si lo guardado tiene más de ~10 min, y entonces en segundo plano
// (lo de antes sigue en pantalla mientras tanto).
import { useCallback, useEffect, useRef } from "react";
import { fetchMap, useMapCache } from "../../features/infra/cache";
import { needsReload } from "../../features/infra/freshness";
import type { ServerSnapshot } from "../../features/infra/graph";
import { toast } from "../../stores/toasts";

interface Options {
  key: string;
  /** Conexión(es) con las que se lee; si cambia (reconexión), se relee. */
  token: string;
  /** Leer solo mientras el mapa está a la vista y conectado. */
  enabled: boolean;
  load: () => Promise<ServerSnapshot[]>;
}

export function useCachedMap({ key, token, enabled, load }: Options) {
  const entry = useMapCache((s) => s.entries[key]);
  const loading = useMapCache((s) => !!s.loading[key]);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(
    (force: boolean) => fetchMap(key, token, () => loadRef.current(), force).catch((e) => toast.error("No se pudo leer el mapa", e)),
    [key, token],
  );

  useEffect(() => {
    if (enabled && needsReload(useMapCache.getState().entries[key], token, Date.now())) void run(false);
  }, [enabled, key, token, run]);

  const refresh = useCallback(() => void run(true), [run]);
  return { snapshots: entry?.snapshots ?? null, at: entry?.at ?? null, loading, refresh };
}
