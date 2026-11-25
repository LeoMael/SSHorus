// Servidor con varias cuentas guardadas (mismo host y puerto): nodo plegable con sus cuentas debajo,
// la que tiene sudo primero. `ServerItems` pinta una lista de servidores ya agrupada.
import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { groupByMachine, machineRowKey, type MachineNode } from "../../features/sidebar/machineGroups";
import { bestTabState, serverRowKey } from "./sidebarLogic";
import { ServerRow, type RowApi } from "./SidebarRows";
import "./MachineGroup.css";

interface ItemsProps {
  api: RowApi;
  servers: readonly ServerProfile[];
  /** Proyecto en el que se ven ("" o ausente = «Servidores»). */
  projectId?: string;
  /** Búsqueda activa: con ella los servidores se ven desplegados. */
  q: string;
}

export function ServerItems({ api, servers, projectId, q }: ItemsProps) {
  const { sudoOf } = api;
  const items = useMemo(() => groupByMachine(servers, (s) => sudoOf.get(s.id) ?? null), [servers, sudoOf]);
  return items.map((it) =>
    it.kind === "server" ? (
      <ServerRow key={serverRowKey(it.account.server.id, projectId)} api={api} s={it.account.server} projectId={projectId} />
    ) : (
      <MachineGroup key={machineRowKey(it.key, projectId)} api={api} node={it} projectId={projectId} q={q} />
    ),
  );
}

const STATE_TITLE = {
  connected: "Alguna cuenta está conectada",
  reconnecting: "Alguna cuenta está reconectando",
  closed: "Alguna pestaña se desconectó",
} as const;

function MachineGroup({ api, node, projectId, q }: { api: RowApi; node: MachineNode; projectId?: string; q: string }) {
  const { tree, menus, machines } = api;
  const key = machineRowKey(node.key, projectId);
  const open = q ? true : !machines.collapsed[key];
  const selected = tree.selected === key;
  const servers = node.accounts.map((a) => a.server);
  const state = bestTabState(servers.map((s) => api.tabStates.get(s.id)));
  const busy = servers.some((s) => api.connecting[s.id]);
  const count = `${servers.length} cuentas`;
  const toggle = (force?: boolean) => machines.toggle(key, force);
  const menu = () => menus.machine(servers, open, () => toggle());
  return (
    <div role="group">
      <div
        data-sb-row
        data-sb-key={key}
        tabIndex={0}
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        aria-label={`${node.label}, ${count}`}
        className={`sb-row sb-machine${projectId ? " sb-indent" : ""}${selected ? " selected" : ""}`}
        title={`${node.label} — ${count} guardadas en este servidor\nClic: desplegar o plegar`}
        onClick={() => {
          tree.setSelected(key);
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            toggle(e.key === "ArrowRight");
          } else tree.rowKeys(e, () => toggle(), key, menu);
        }}
        onContextMenu={(e) => tree.openMenuAt(e, key, menu())}
      >
        <span className="sb-lead">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="sb-lead">
          {busy ? (
            <span className="spinner sb-spinner" aria-label="Conectando" />
          ) : (
            <span
              className={`status-dot${state === "connected" ? " on" : state ? ` sb-dot-${state}` : ""}`}
              title={state ? STATE_TITLE[state] : "Ninguna cuenta conectada"}
            />
          )}
        </span>
        <span className="sb-name sb-machine-name">{node.label}</span>
        <span className="sb-count">{count}</span>
      </div>
      {open &&
        servers.map((s) => (
          <ServerRow key={serverRowKey(s.id, projectId)} api={api} s={s} projectId={projectId} inMachine />
        ))}
    </div>
  );
}
