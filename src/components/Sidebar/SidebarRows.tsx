// Filas del árbol de la barra lateral: servidor y marcador.
import { Folder } from "lucide-react";
import type { Bookmark, Project, ServerProfile } from "../../api/types";
import { serverAddress } from "../../features/profiles/serverMatches";
import type { SudoBadge } from "../../features/sidebar/machineGroups";
import { isMac, isModKey } from "../../lib/platform";
import { connectNew, openOrFocus } from "./sidebarActions";
import { bookmarkRowKey, serverRowKey, type TabState } from "./sidebarLogic";
import type { SidebarMenus } from "./sidebarMenus";
import type { CollapsedMachines } from "./useCollapsedProjects";
import type { SidebarTree } from "./useSidebarTree";

const MOD = isMac ? "⌘" : "Ctrl";
const OPEN_HINT = `Doble clic: abrir o ir a su pestaña · ${MOD}+doble clic: nueva conexión`;

const DOT_TITLE: Record<TabState, string> = {
  connected: "Conectado — doble clic para ir a su pestaña",
  reconnecting: "Reconectando — doble clic para ir a su pestaña",
  closed: "Pestaña desconectada — doble clic para ir a ella y reconectar",
};

/** Lo que necesitan las filas del árbol (estado de la barra y sus menús). */
export interface RowApi {
  tree: SidebarTree;
  menus: SidebarMenus;
  connecting: Record<string, true>;
  tabStates: ReadonlyMap<string, TabState>;
  serverById: ReadonlyMap<string, ServerProfile>;
  /** Marca de sudo de cada servidor (ver useAccountSudo). */
  sudoOf: ReadonlyMap<string, SudoBadge | null>;
  machines: CollapsedMachines;
}

const SUDO_TITLE: Record<SudoBadge, string> = {
  sudo: "Esta cuenta tiene sudo (administrador)",
  root: "Esta cuenta es root (administrador)",
};

function SudoMark({ sudo }: { sudo: SudoBadge }) {
  return (
    <span className="sb-sudo" role="img" title={SUDO_TITLE[sudo]} aria-label={SUDO_TITLE[sudo]}>
      S
    </span>
  );
}

interface ServerRowProps {
  api: RowApi;
  s: ServerProfile;
  projectId?: string;
  /** Cuenta dentro del nodo de su servidor: un nivel más adentro y solo el usuario debajo. */
  inMachine?: boolean;
}

/** Sangría según la profundidad en el árbol (0 = «Servidores», 1 = proyecto o servidor, 2 = ambos). */
const INDENT = ["", " sb-indent", " sb-indent-2"];

export function ServerRow({ api, s, projectId, inMachine }: ServerRowProps) {
  const { tree, menus } = api;
  const key = serverRowKey(s.id, projectId);
  const isConnecting = !!api.connecting[s.id];
  const tabState = api.tabStates.get(s.id);
  const selected = tree.selected === key;
  const sudo = api.sudoOf.get(s.id);
  return (
    <div
      data-sb-row
      data-sb-key={key}
      tabIndex={0}
      role="treeitem"
      aria-selected={selected}
      className={`sb-row${INDENT[Number(!!projectId) + Number(!!inMachine)]}${selected ? " selected" : ""}`}
      title={`${s.name} — ${serverAddress(s)}\n${OPEN_HINT}`}
      onClick={() => tree.setSelected(key)}
      onDoubleClick={(e) => (isModKey(e) ? connectNew(s) : openOrFocus(s))}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        tree.setSelected(key);
        connectNew(s);
      }}
      onKeyDown={(e) =>
        tree.rowKeys(e, (withMod) => (withMod ? connectNew(s) : openOrFocus(s)), key, () => menus.server(s, projectId))
      }
      onContextMenu={(e) => tree.openMenuAt(e, key, menus.server(s, projectId))}
    >
      {s.color && <span className="sb-colorbar" style={{ background: s.color }} />}
      <span className="sb-lead">
        {isConnecting ? (
          <span className="spinner sb-spinner" aria-label="Conectando" />
        ) : (
          <span
            className={`status-dot${tabState === "connected" ? " on" : tabState ? ` sb-dot-${tabState}` : ""}`}
            title={tabState ? DOT_TITLE[tabState] : "Sin conexión abierta"}
          />
        )}
      </span>
      <span className="sb-name">{s.name}</span>
      {sudo && <SudoMark sudo={sudo} />}
      <span className="sb-sub">{inMachine ? s.username : serverAddress(s)}</span>
    </div>
  );
}

export function BookmarkRow({ api, p, b }: { api: RowApi; p: Project; b: Bookmark }) {
  const { tree, menus } = api;
  const s = api.serverById.get(b.serverId);
  const key = bookmarkRowKey(p.id, b);
  const selected = tree.selected === key;
  return (
    <div
      data-sb-row
      tabIndex={0}
      role="treeitem"
      aria-selected={selected}
      className={`sb-row sb-indent sb-bookmark${selected ? " selected" : ""}`}
      title={`${s?.name ?? "Servidor eliminado"}: ${b.path}`}
      onClick={() => {
        tree.setSelected(key);
        if (s) connectNew(s, b.path);
      }}
      onKeyDown={(e) => tree.rowKeys(e, () => s && connectNew(s, b.path), key, () => menus.bookmark(p, b, s))}
      onContextMenu={(e) => tree.openMenuAt(e, key, menus.bookmark(p, b, s))}
    >
      <span className="sb-lead">
        {s && api.connecting[s.id] ? <span className="spinner sb-spinner" /> : <Folder size={14} className="sb-folder" />}
      </span>
      <span className="sb-name">{b.label || b.path}</span>
      <span className="sb-sub">{b.label ? b.path : s?.name}</span>
    </div>
  );
}
