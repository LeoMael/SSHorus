// Selector «Lo mío» / «Todo el servidor» y la caja plegada «Otros» de cada servidor.
import { othersText, type MapScope } from "../../features/infra/scope";
import type { Box } from "../../features/infra/layout";
import { Segmented } from "../ui/Segmented";
// Estilos del selector (.adm-seg): el mapa de un proyecto se abre sin Administración cargada.
import "../Admin/Admin.css";
import "./MapScope.css";

/** Prefijo del `data-node` de la caja «Otros»: un clic en ella muestra todo ese servidor. */
export const FOLD_PREFIX = "fold:";

const OPTIONS: { value: MapScope; label: string; title: string }[] = [
  { value: "mine", label: "Lo mío", title: "Solo lo tuyo y, en gris, el camino desde Internet hasta ello" },
  { value: "all", label: "Todo el servidor", title: "También lo del sistema y de otros usuarios" },
];

export function ScopeSwitch({ value, onChange }: { value: MapScope | null; onChange: (v: MapScope) => void }) {
  return (
    <Segmented<MapScope | "mixed">
      label="Qué se ve en el mapa"
      value={value ?? "mixed"}
      options={OPTIONS}
      onChange={(v) => v !== "mixed" && onChange(v)}
    />
  );
}

export function FoldBox({ box, serverId, hidden }: { box: Box; serverId: string; hidden: number }) {
  const text = othersText(hidden);
  return (
    <g data-node={`${FOLD_PREFIX}${serverId}`} className="im-fold">
      <title>{`${text}. Clic para verlo todo.`}</title>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} className="im-fold-box" />
      <text x={box.x + 12} y={box.y + box.h / 2 + 4} className="im-fold-text">
        {text} —
      </text>
      <text x={box.x + box.w - 12} y={box.y + box.h / 2 + 4} textAnchor="end" className="im-fold-link">
        Ver todo
      </text>
    </g>
  );
}
