// Leyenda del mapa (esquina inferior izquierda): qué es cada icono y cada color. Se puede plegar.
import { useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Health, NodeKind } from "../../features/infra/graph";
import { HEALTH_LABEL, KIND_LABEL, NODE_ICON } from "./nodeMeta";
import "./MapPanels.css";

const KINDS: NodeKind[] = ["firewall", "port", "proxy", "site", "container", "service", "process", "db"];
const HEALTHS: Health[] = ["ok", "warn", "bad", "off"];

export function MapLegend() {
  const [open, setOpen] = useState(true);
  const stop = (e: RPointerEvent) => e.stopPropagation();
  return (
    <div className={`im-legend${open ? "" : " closed"}`} aria-label="Leyenda">
      <button className="im-legend-toggle" onClick={() => setOpen((o) => !o)} onPointerDown={stop} onPointerUp={stop} aria-expanded={open}>
        Leyenda {open ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      </button>
      {open && (
        <>
          {KINDS.map((k) => {
            const Icon = NODE_ICON[k];
            return (
              <span key={k} className={`im-k-${k}`}>
                <Icon size={12} className="im-icon" /> {KIND_LABEL[k]}
              </span>
            );
          })}
          <i className="im-legend-sep" aria-hidden="true" />
          {HEALTHS.map((h) => (
            <span key={h}>
              <i className={`im-dot-html im-h-${h}`} /> {HEALTH_LABEL[h].toLowerCase()}
            </span>
          ))}
          <span>
            <i className="im-line-x" /> entre servidores
          </span>
        </>
      )}
    </div>
  );
}
