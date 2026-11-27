// Tarjeta de un nodo del lienzo: icono del tipo, nombre y detalle recortados al ancho (completos al pasar
// el ratón) y, si no está bien, el icono de su estado además del color. También la tarjeta «+N» que
// agrupa una lista larga.
import { memo, type FocusEvent } from "react";
import { ChevronsDown } from "lucide-react";
import { fitText, nodeStatus, ROUTE_OWNER, type PlacedNode } from "../../features/infra";
import { HEALTH_ICON, KIND_LABEL, NODE_ICON, textWidth } from "./nodeMeta";

const LABEL_PX = 12.5;
const SUB_PX = 10.5;
const TEXT_X = 34;

function fit(text: string, max: number, px: number, weight: number): string {
  return fitText(text, max, (s) => textWidth(s, px, weight));
}

interface Props {
  p: PlacedNode;
  selected: boolean;
  dim: boolean;
  onActivate: (id: string) => void;
  /** Con el teclado: el nodo recibe el foco (para traerlo a la vista). */
  onFocusNode: (p: PlacedNode, e: FocusEvent<SVGGElement>) => void;
}

export const MapNodeCard = memo(function MapNodeCard({ p, selected, dim, onActivate, onFocusNode }: Props) {
  const n = p.node;
  const Icon = NODE_ICON[n.kind];
  const status = nodeStatus(n);
  const flag = n.health !== "ok";
  const Flag = HEALTH_ICON[n.health];
  const right = p.w - 8 - (flag ? 16 : 0);
  const desc = `${KIND_LABEL[n.kind]}: ${n.label}${n.sub ? `, ${n.sub}` : ""}. ${status.text}`;
  return (
    <g
      data-node={n.id}
      className={`im-node im-k-${n.kind} im-n-${n.health}${n.owner === ROUTE_OWNER ? " ghost" : ""}${selected ? " sel" : ""}${dim ? " dim" : ""}`}
      transform={`translate(${p.x},${p.y})`}
      tabIndex={0}
      role="button"
      aria-label={desc}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onActivate(n.id);
      }}
      onFocus={(e) => onFocusNode(p, e)}
    >
      <title>{`${KIND_LABEL[n.kind]}: ${n.label}${n.sub ? `\n${n.sub}` : ""}\nEstado: ${status.text}`}</title>
      <rect width={p.w} height={p.h} rx={6} className="im-card" />
      <rect width={3} height={p.h - 12} x={0} y={6} rx={1.5} className={`im-stripe im-h-${n.health}`} />
      <Icon x={10} y={p.h / 2 - 8} width={16} height={16} className="im-icon" />
      <text x={TEXT_X} y={n.sub ? 19 : 27} className="im-label">
        {fit(n.label, right - TEXT_X, LABEL_PX, 600)}
      </text>
      {n.sub && (
        <text x={TEXT_X} y={33} className="im-sub">
          {fit(n.sub, p.w - 8 - TEXT_X, SUB_PX, 400)}
        </text>
      )}
      {flag && <Flag x={p.w - 19} y={6} width={13} height={13} className={`im-flag im-t-${n.health}`} />}
    </g>
  );
});

/** «+12 puertos»: clic o Intro para desplegar la columna. */
export const MapMoreCard = memo(function MapMoreCard({ p, names, onActivate }: { p: PlacedNode; names: string[]; onActivate: (id: string) => void }) {
  const n = p.node;
  const Icon = NODE_ICON[n.kind];
  const flag = n.health === "bad" || n.health === "warn";
  const shown = names.slice(0, 12).join("\n") + (names.length > 12 ? "\n…" : "");
  return (
    <g
      data-node={n.id}
      className="im-node im-more"
      transform={`translate(${p.x},${p.y})`}
      tabIndex={0}
      role="button"
      aria-label={`${n.label} ocultos. Mostrarlos`}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onActivate(n.id);
      }}
    >
      <title>{`${n.label} ocultos (clic para verlos):\n${shown}`}</title>
      <rect width={p.w} height={p.h} rx={6} className="im-card" />
      <Icon x={10} y={p.h / 2 - 8} width={16} height={16} className="im-icon" />
      <text x={TEXT_X} y={19} className="im-label">
        {n.label}
      </text>
      <text x={TEXT_X} y={33} className="im-more-link">
        {n.sub}
      </text>
      <ChevronsDown x={p.w - 22} y={p.h / 2 - 7} width={14} height={14} className="im-more-chev" />
      {flag && <circle cx={p.w - 10} cy={9} r={3.5} className={`im-h-${n.health}`} />}
    </g>
  );
});
