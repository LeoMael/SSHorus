// Contenido de la pestaña del Panel de VPS que está a la vista (App lo monta junto a las de servidor).
// Las demás pestañas del panel no se montan: sus datos y conexiones viven en features/fleet/runtime.
import { Suspense } from "react";
import { useFleetTabs } from "../../features/fleet/tabs";
import { preloadable } from "../../lib/lazy";

const FleetPanel = preloadable(() => import("./FleetPanel").then((m) => m.FleetPanel));

export function FleetHost({ activeId }: { activeId: string | null }) {
  const tab = useFleetTabs((s) => s.tabs.find((t) => t.id === activeId) ?? null);
  if (!tab) return null;
  return (
    <Suspense
      fallback={
        <div className="app-loading">
          <div className="spinner" />
        </div>
      }
    >
      <FleetPanel key={tab.id} tab={tab} />
    </Suspense>
  );
}
