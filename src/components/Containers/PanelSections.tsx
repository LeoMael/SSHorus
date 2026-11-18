// Sub-pestañas del panel de Contenedores (barra y contenido). Las que no son la primera se cargan al abrirlas.
import { Suspense, lazy } from "react";
import { ShieldAlert } from "lucide-react";
import type { ResourceMap } from "./context";
import { ContainersTab } from "./ContainersTab";
import { SUBTABS, type SubTab } from "./panelLogic";

const ImagesTab = lazy(() => import("./ImagesTab").then((m) => ({ default: m.ImagesTab })));
const VolumesTab = lazy(() => import("./VolumesTab").then((m) => ({ default: m.VolumesTab })));
const NetworksTab = lazy(() => import("./NetworksTab").then((m) => ({ default: m.NetworksTab })));
const ComposeTab = lazy(() => import("./ComposeTab").then((m) => ({ default: m.ComposeTab })));
const CleanupTab = lazy(() => import("./CleanupTab").then((m) => ({ default: m.CleanupTab })));

export function SubTabBar({ tab, setTab, res }: { tab: SubTab; setTab: (t: SubTab) => void; res: ResourceMap }) {
  return (
    <div className="ct-tabs" role="tablist" aria-label="Secciones">
      {SUBTABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={tab === t.id ? "ct-tab on" : "ct-tab"}
          onClick={() => setTab(t.id)}
        >
          {t.label}
          {t.id === "containers" && res.containers.data && <span className="ct-count">{res.containers.data.length}</span>}
          {t.id === "images" && res.images.data && <span className="ct-count">{res.images.data.length}</span>}
        </button>
      ))}
    </div>
  );
}

interface BodyProps {
  tab: SubTab;
  runnable: boolean;
  sudoMissing: boolean;
  waitingUsers: boolean;
  /** Motivo por el que no se puede usar el motor. */
  problem: string | null;
}

export function SubTabBody({ tab, runnable, sudoMissing, waitingUsers, problem }: BodyProps) {
  return (
    <div className="ct-body">
      {!runnable ? (
        <div className="empty-state">
          {waitingUsers && !sudoMissing ? <span className="spinner" /> : <ShieldAlert size={26} />}
          <div>
            {sudoMissing
              ? "Introduce la contraseña de sudo para ver los contenedores"
              : waitingUsers
                ? "Buscando usuarios con contenedores…"
                : (problem ?? "No se puede usar el motor")}
          </div>
        </div>
      ) : (
        <Suspense fallback={<div className="empty-state"><span className="spinner" /></div>}>
          {tab === "containers" && <ContainersTab />}
          {tab === "images" && <ImagesTab />}
          {tab === "volumes" && <VolumesTab />}
          {tab === "networks" && <NetworksTab />}
          {tab === "compose" && <ComposeTab />}
          {tab === "cleanup" && <CleanupTab />}
        </Suspense>
      )}
    </div>
  );
}
