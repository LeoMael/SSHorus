// Panel lateral del mapa con lo que se sabe del nodo elegido; el cortafuegos enseña aquí sus reglas.
import { X } from "lucide-react";
import type { MapNode, NavTarget, ServerSnapshot } from "../../features/infra";
import { FirewallPanel } from "./FirewallPanel";
import { HEALTH_LABEL, KIND_LABEL, NODE_ICON } from "./nodeMeta";
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
  const firewall = node.kind === "firewall";
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
          <Icon size={18} className="im-icon" />
        </span>
        <div className="im-details-title">
          <strong>{node.label}</strong>
          <span className="faint">
            {KIND_LABEL[node.kind]} · <i className={`im-dot-html im-h-${node.health}`} aria-hidden="true" /> {HEALTH_LABEL[node.health]}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
      <dl className="im-dl">
        {serverName && (
          <div className="im-dl-row">
            <dt>Servidor</dt>
            <dd>{serverName}</dd>
          </div>
        )}
        {node.details.map(([k, v], i) => (
          <div key={i} className="im-dl-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {node.nav && node.server && onNav && (
        <button className="btn btn-sm" onClick={() => onNav(node.server!, node.nav!)}>
          {NAV_LABEL[node.nav.kind]}
        </button>
      )}
      {firewall && snapshot && <FirewallPanel key={snapshot.id} snap={snapshot} />}
    </aside>
  );
}
