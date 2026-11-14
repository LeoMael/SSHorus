// Estado del lienzo del mapa (filtros, selección, minimapa) que se recuerda al salir y se recupera al
// volver, para que regresar al mapa lo deje tal cual estaba.
import { useEffect, useRef, useState } from "react";
import { savedCanvas, saveCanvas, type SavedCanvas } from "../../features/infra/cache";

export function useMapCanvas(key: string) {
  const [saved] = useState(() => savedCanvas(key));
  const [hideLocal, setHideLocal] = useState(saved?.hideLocal ?? false);
  const [hideSystem, setHideSystem] = useState(saved?.hideSystem ?? true);
  const [owners, setOwners] = useState<Set<string> | null>(saved?.owners ? new Set(saved.owners) : null);
  const [selected, setSelected] = useState<string | null>(saved?.selected ?? null);
  const [miniOn, setMiniOn] = useState(saved?.miniOn ?? true);

  const current = useRef<SavedCanvas | null>(null);
  current.current = { hideLocal, hideSystem, owners: owners ? [...owners] : null, selected, miniOn };
  useEffect(
    () => () => {
      if (current.current) saveCanvas(key, current.current);
    },
    [key],
  );

  /** Cambia con los filtros (la vista se reajusta entonces). */
  const refitKey = `${hideLocal}|${hideSystem}|${owners ? [...owners].sort().join(",") : "*"}`;

  return { hideLocal, setHideLocal, hideSystem, setHideSystem, owners, setOwners, selected, setSelected, miniOn, setMiniOn, refitKey };
}
