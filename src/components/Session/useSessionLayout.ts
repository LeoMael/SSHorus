// Paneles de la pestaña: reparto guardado (trabajo | terminal y vista fija | editores) y plegar la terminal.
import { useCallback, useState } from "react";
import { usePanelRef, type Layout, type LayoutChangedMeta } from "react-resizable-panels";
import { useSettings } from "../../stores/settings";
import { initialLayout, splitLayout } from "./workArea";

export function useSessionLayout() {
  const [termCollapsed, setTermCollapsed] = useState(false);
  const termPanel = usePanelRef();
  const setLayout = useSettings((s) => s.setLayout);
  const [defaultLayout] = useState(() => initialLayout(useSettings.getState().settings.layout.session));
  const [defaultSplit] = useState(() => splitLayout(useSettings.getState().settings.layout.sessionSplit));

  const toggleTerminal = useCallback(() => {
    const p = termPanel.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, [termPanel]);

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const l = meta.requestedLayout ?? layout;
      if ((l.terminal ?? 0) < 5) return; // no guardar el estado plegado
      setLayout("session", [l.work, l.terminal]);
    },
    [setLayout],
  );

  const onSplitChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const l = meta.requestedLayout ?? layout;
      if (!(l.side >= 10 && l.editors >= 10)) return;
      setLayout("sessionSplit", [l.side, l.editors]);
    },
    [setLayout],
  );

  /** Al cambiar de tamaño el panel de la terminal: ¿quedó plegado? */
  const onTermResize = () => setTermCollapsed(termPanel.current?.isCollapsed() ?? false);

  return { termCollapsed, termPanel, defaultLayout, defaultSplit, toggleTerminal, onLayoutChanged, onSplitChanged, onTermResize };
}
