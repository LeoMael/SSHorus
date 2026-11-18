// Contenido del área de trabajo: las vistas fijas (Archivos y paneles que se cargan al abrirlos)
// y los editores de los archivos abiertos. Todos quedan montados; el CSS oculta los que no se ven.
import { lazy, Suspense, useState, type ComponentType, type RefObject } from "react";
import { preloadable } from "../../lib/lazy";
import type { RemoteEditorHandle } from "../Editor/RemoteEditor";
import { FileExplorer } from "../FileExplorer/FileExplorer";
import type { FixedTab } from "./fixedViews";

const RemoteEditor = lazy(() => import("../Editor/RemoteEditor"));
/** Biblioteca de comandos (catálogo grande): se carga la primera vez que se abre la pestaña «Comandos». */
export const CommandsPanel = preloadable(() => import("../Commands/CommandsPanel").then((m) => m.CommandsPanel));
/** Administración del servidor: se carga la primera vez que se abre su pestaña. */
const AdminPanel = preloadable(() => import("../Admin/AdminPanel").then((m) => m.AdminPanel));
/** Monitoreo en vivo (CPU, memoria, disco, red, procesos). */
const MonitorPanel = preloadable(() => import("../Monitor/MonitorPanel").then((m) => m.MonitorPanel));
/** Contenedores (Podman / Docker) del servidor. */
const ContainersPanel = preloadable(() => import("../Containers/ContainersPanel").then((m) => m.ContainersPanel));
/** Túneles (port forwarding) de esta conexión. */
const TunnelsPanel = preloadable(() => import("../Tunnels/TunnelsPanel").then((m) => m.TunnelsPanel));

interface PanelProps {
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
  onOpenFile?: (path: string) => void;
}

/** Vistas fijas que se montan la primera vez que se abren y luego se conservan (en el orden del DOM). */
const LAZY_PANELS: { id: FixedTab; Panel: ComponentType<PanelProps>; opensFiles?: boolean }[] = [
  { id: "commands", Panel: CommandsPanel },
  { id: "containers", Panel: ContainersPanel },
  { id: "monitor", Panel: MonitorPanel },
  { id: "tunnels", Panel: TunnelsPanel },
  { id: "admin", Panel: AdminPanel, opensFiles: true },
];

const spinner = (text?: string) => (
  <div className="empty-state">
    <div className="spinner" />
    {text && <span>{text}</span>}
  </div>
);

/** Vistas fijas ya abiertas alguna vez (Archivos siempre lo está). */
export function useMountedViews(side: FixedTab): ReadonlySet<FixedTab> {
  const [mounted, setMounted] = useState<ReadonlySet<FixedTab>>(() => new Set(["files"]));
  if (!mounted.has(side)) setMounted(new Set([...mounted, side]));
  return mounted;
}

interface SidePanesProps {
  sessionId: string;
  profileId: string;
  initialPath: string | null;
  side: FixedTab;
  mounted: ReadonlySet<FixedTab>;
  /** La pestaña del servidor se ve y la columna de vistas fijas también. */
  visible: boolean;
  connected: boolean;
  openFile: (path: string) => void;
  onPathChange: (path: string) => void;
}

export function SidePanes({ sessionId, profileId, initialPath, side, mounted, visible, connected, openFile, onPathChange }: SidePanesProps) {
  const pane = (id: FixedTab) => (side === id ? "sv-pane" : "sv-pane sv-hidden");
  return (
    <div className="sv-work-body">
      <div className={pane("files")}>
        <FileExplorer
          sessionId={sessionId}
          initialPath={initialPath}
          active={visible && side === "files" && connected}
          onOpenFile={openFile}
          onPathChange={onPathChange}
        />
      </div>
      {LAZY_PANELS.filter((v) => mounted.has(v.id)).map(({ id, Panel, opensFiles }) => (
        <div key={id} className={pane(id)}>
          <Suspense fallback={spinner()}>
            <Panel
              sessionId={sessionId}
              profileId={profileId}
              active={visible && side === id}
              disabled={!connected}
              {...(opensFiles ? { onOpenFile: openFile } : {})}
            />
          </Suspense>
        </div>
      ))}
    </div>
  );
}

interface EditorPanesProps {
  sessionId: string;
  /** Archivos en orden de apertura (orden fijo en el DOM). */
  stable: string[];
  current: string | null;
  /** La pestaña del servidor se ve y la columna de editores también. */
  visible: boolean;
  connected: boolean;
  editors: RefObject<Map<string, RemoteEditorHandle>>;
  onDirtyChange: (path: string, dirty: boolean) => void;
}

export function EditorPanes({ sessionId, stable, current, visible, connected, editors, onDirtyChange }: EditorPanesProps) {
  return (
    <div className="sv-work-body">
      {stable.map((p) => (
        <div key={p} className={current === p ? "sv-pane" : "sv-pane sv-hidden"}>
          <Suspense fallback={spinner("Cargando editor…")}>
            <RemoteEditor
              ref={(h: RemoteEditorHandle | null) => {
                if (h) editors.current.set(p, h);
                else editors.current.delete(p);
              }}
              sessionId={sessionId}
              path={p}
              active={visible && current === p}
              offline={!connected}
              onDirtyChange={(d) => onDirtyChange(p, d)}
            />
          </Suspense>
        </div>
      ))}
    </div>
  );
}
