// Diagrama de relaciones en SVG: tablas como cajas y flechas de cada clave foránea a su tabla. Los colores
// salen de las variables del tema (se ve bien en claro y oscuro). Pulsar una caja abre su detalle.
import { useMemo } from "react";
import { KeyRound } from "lucide-react";
import { HEAD_H, MAX_TABLES, ROW_H, layoutDiagram, tableId } from "../../features/databases/diagram";
import type { DbTable } from "../../features/databases/types";

interface Props {
  tables: DbTable[];
  selected: string | null;
  onPick: (t: DbTable) => void;
}

/** Corta un texto para que quepa en la caja (aprox. 7 px por carácter en 12 px). */
function fit(s: string, px: number): string {
  const max = Math.max(4, Math.floor(px / 7));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function SchemaDiagram({ tables, selected, onPick }: Props) {
  const d = useMemo(() => layoutDiagram(tables), [tables]);
  if (tables.length === 0) return <div className="empty-state">No hay tablas que dibujar.</div>;
  const related = new Set(d.edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to]));

  return (
    <div className="db-diagram">
      {tables.length > MAX_TABLES && (
        <div className="db-banner">Solo se dibujan {MAX_TABLES} de {tables.length} tablas: usa la búsqueda para ver las que te interesan.</div>
      )}
      <svg width={d.width} height={d.height} viewBox={`0 0 ${d.width} ${d.height}`} role="img" aria-label="Diagrama de relaciones entre tablas">
        <defs>
          <marker id="db-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="db-arrow-head" />
          </marker>
        </defs>
        {d.edges.map((e) => (
          <path key={e.id} d={e.path} className={e.from === selected || e.to === selected ? "db-edge on" : "db-edge"} markerEnd="url(#db-arrow)">
            <title>{e.label}</title>
          </path>
        ))}
        {d.boxes.map((b) => {
          const on = b.id === selected;
          return (
            <g
              key={b.id}
              className={on ? "db-box on" : related.has(b.id) ? "db-box near" : "db-box"}
              transform={`translate(${b.x} ${b.y})`}
              onClick={() => onPick(b.table)}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onPick(b.table)}
            >
              <title>{tableId(b.table)}</title>
              <rect className="db-box-bg" width={b.w} height={b.h} rx={6} />
              <rect className="db-box-head" width={b.w} height={HEAD_H} rx={6} />
              <rect className="db-box-head" y={HEAD_H - 6} width={b.w} height={6} />
              <text className="db-box-title" x={10} y={17}>
                {fit(b.table.name, b.w - 20)}
              </text>
              {b.cols.map((c, i) => (
                <g key={c.name} transform={`translate(0 ${HEAD_H + i * ROW_H})`}>
                  {c.pk && <KeyRound x={8} y={4} width={10} height={10} className="db-box-pk" />}
                  <text className="db-box-col" x={22} y={13}>
                    {fit(c.name, b.w * 0.55)}
                  </text>
                  <text className="db-box-type" x={b.w - 8} y={13} textAnchor="end">
                    {fit(c.type, b.w * 0.35)}
                  </text>
                </g>
              ))}
              {b.hidden > 0 && (
                <text className="db-box-type" x={22} y={HEAD_H + b.cols.length * ROW_H + 13}>
                  +{b.hidden} más
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
