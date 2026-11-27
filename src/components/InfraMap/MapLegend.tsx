// Leyenda del mapa (esquina inferior izquierda): tipos de nodo, estados (color e icono) y líneas. Empieza
// plegada; lo que elija el usuario se recuerda mientras la app está abierta.
import { useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import type { EdgeKind, Health, NodeKind } from "../../features/infra";
import { HEALTH_ICON, KIND_LABEL, NODE_ICON } from "./nodeMeta";
import "./MapPanels.css";

const KINDS: NodeKind[] = ["firewall", "port", "proxy", "site", "container", "service", "process", "db"];
const HEALTHS: [Health, string][] = [
  ["ok", "Bien / activo"],
  ["warn", "Aviso"],
  ["bad", "Error o caído"],
  ["off", "Parado o sin datos"],
];
const LINES: [EdgeKind, string][] = [
  ["net", "Conexión"],
  ["proxy", "Proxy → destino"],
  ["publish", "Puerto publicado"],
  ["cross", "Entre servidores"],
];

let rememberedOpen = false;

export function MapLegend() {
  const [open, setOpenState] = useState(rememberedOpen);
  const setOpen = (o: boolean) => {
    rememberedOpen = o;
    setOpenState(o);
  };
  const stop = (e: RPointerEvent) => e.stopPropagation();
  return (
    <div className={`im-legend${open ? " open" : ""}`} aria-label="Leyenda" onPointerDown={stop} onPointerUp={stop}>
      <button className="im-legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Info size={12} /> Leyenda {open ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      </button>
      {open && (
        <div className="im-legend-body">
          <div className="im-legend-sec">
            <span className="im-legend-title">Tipos</span>
            {KINDS.map((k) => {
              const Icon = NODE_ICON[k];
              return (
                <span key={k} className={`im-legend-item im-k-${k}`}>
                  <Icon size={12} className="im-icon" /> {KIND_LABEL[k]}
                </span>
              );
            })}
          </div>
          <div className="im-legend-sec">
            <span className="im-legend-title">Estado</span>
            {HEALTHS.map(([h, text]) => {
              const Icon = HEALTH_ICON[h];
              return (
                <span key={h} className="im-legend-item">
                  <Icon size={12} className={`im-flag im-t-${h}`} /> {text}
                </span>
              );
            })}
            <span className="im-legend-title">Líneas</span>
            {LINES.map(([k, text]) => (
              <span key={k} className="im-legend-item">
                <i className={`im-legend-line im-l-${k}`} aria-hidden="true" /> {text}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
