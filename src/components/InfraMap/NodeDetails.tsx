// Panel lateral del mapa con lo que se sabe del nodo elegido; el cortafuegos enseña aquí sus reglas.
import { X } from "lucide-react";
import { nodeStatus, type MapNode, type NavTarget, type ServerSnapshot } from "../../features/infra";
import { MapPortClose } from "../PortClose/MapPortClose";
import { FirewallPanel } from "./FirewallPanel";
import { HEALTH_ICON, KIND_LABEL, NODE_ICON } from "./nodeMeta";
import "./MapPanels.css";

const NAV_LABEL: Record<NavTarget["kind"], string> = { ports: "Ver en Puertos", web: "Ver en Sitios web", containers: "Ver en Contenedores" };

export function NodeDetails({
  node,
  serverName,
  snapshot,
  onNav,
  onClose,
}: {
  node: MapNode;
  serverName: string | null;
  /** Lo leído del servidor del nodo (para el cortafuegos; null en la vista previa). */
  snapshot: ServerSnapshot | null;
  onNav?: (serverId: string, target: NavTarget) => void;
  onClose: () => void;
}) {
  const Icon = NODE_ICON[node.kind];
  const status = nodeStatus(node);
  const StatusIcon = HEALTH_ICON[node.health];
  const firewall = node.kind === "firewall";
  const rows: [string, string][] = [...(serverName ? [["Servidor", serverName] as [string, string]] : []), ...node.details];
  const nav = node.nav && node.server && onNav ? { server: node.server, target: node.nav } : null;
  const closePort = node.kind === "port" && snapshot;
  return (
    <aside
      className={`im-details${firewall ? " wide" : ""}`}
      aria-label={`Detalles: ${node.label}`}
      onKeyDown={(e) => {
        // Esc cierra el panel (y no la ventana del mapa de proyecto que lo contiene).
        if (e.key !== "Escape" || document.querySelector(".modal-backdrop .adm-modal")) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="im-details-head">
        <span className={`im-details-icon im-k-${node.kind}`} aria-hidden="true">
          <Icon size={16} className="im-icon" />
        </span>
        <div className="im-details-title">
          <strong title={node.label}>{node.label}</strong>
          <span className="faint">{KIND_LABEL[node.kind]}</span>
        </div>
        <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
      <div className={`im-status im-s-${node.health}`} role="status">
        <StatusIcon size={13} className={`im-flag im-t-${node.health}`} aria-hidden="true" />
        <span>{status.text}</span>
      </div>
      <dl className="im-dl">
        {rows.map(([k, v], i) => (
          <div key={i} className="im-dl-row">
            <dt title={k}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {(nav || closePort) && (
        <div className="im-details-actions">
          {nav && (
            <button className="btn btn-sm" onClick={() => onNav!(nav.server, nav.target)}>
              {NAV_LABEL[nav.target.kind]}
            </button>
          )}
          {closePort && <MapPortClose node={node} snap={snapshot} />}
        </div>
      )}
      {firewall && snapshot && <FirewallPanel key={snapshot.id} snap={snapshot} />}
    </aside>
  );
}
