// Columnas redimensionables de la Biblioteca de comandos: tamaños guardados en los ajustes y el separador.
import { useCallback } from "react";
import { Separator, type Layout, type LayoutChangedMeta } from "react-resizable-panels";
import { useSettings } from "../../stores/settings";

export const OUTER_IDS = ["cats", "content"];
export const INNER_IDS = ["list", "detail"];

export function savedLayout(key: string, ids: string[], fallback: number[]): Layout {
  const saved = useSettings.getState().settings.layout[key];
  const v = saved && saved.length === ids.length && saved.every((n) => n > 0) ? saved : fallback;
  return Object.fromEntries(ids.map((id, i) => [id, v[i]]));
}

/** Guarda el reparto solo cuando lo cambia el usuario (no al montar ni al cambiar el tamaño de la ventana). */
export function useLayoutSaver(key: string, ids: string[]) {
  const setLayout = useSettings((s) => s.setLayout);
  return useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const l = meta.requestedLayout ?? layout;
      setLayout(key, ids.map((id) => l[id] ?? 0));
    },
    [key, ids, setLayout],
  );
}

export function ColSep() {
  return (
    <Separator className="app-sep app-sep-v">
      <span className="app-sep-grip" />
    </Separator>
  );
}
