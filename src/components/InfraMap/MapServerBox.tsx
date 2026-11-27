// Fondo del lienzo: caja de cada servidor (nombre, estado en palabras, sistema y cortafuegos), sus bandas
// por usuario, la caja plegada «Otros» y los recuadros de Compose/pod.
import { ownerLabel, ROUTE_OWNER, serverStatusText, type MapServer, type PlacedGroup, type PlacedServer } from "../../features/infra";
import { FoldBox } from "./MapScope";
import { HEALTH_ICON, textWidth } from "./nodeMeta";

export function MapServerBox({ box, srv }: { box: PlacedServer; srv: MapServer }) {
  const state = serverStatusText(srv);
  const Flag = HEALTH_ICON[srv.health];
  const nameEnd = box.x + 28 + textWidth(srv.name, 14, 700);
  return (
    <g>
      <title>{`${srv.name} (${srv.host})${state ? ` — ${state}` : ""}`}</title>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} className="im-server" />
      {srv.health === "ok" ? (
        <circle cx={box.x + 16} cy={box.y + 17} r={4.5} className="im-dot im-h-ok" />
      ) : (
        <Flag x={box.x + 9} y={box.y + 10} width={14} height={14} className={`im-flag im-t-${srv.health}`} />
      )}
      <text x={box.x + 28} y={box.y + 22} className="im-server-name">
        {srv.name}
      </text>
      {state && (
        <text x={nameEnd + 8} y={box.y + 22} className={`im-server-state im-t-${srv.health}`}>
          {state}
        </text>
      )}
      <text x={box.x + box.w - 12} y={box.y + 22} className="im-server-sub" textAnchor="end">
        {[srv.os, srv.firewall].filter(Boolean).join(" · ")}
      </text>
      {box.bands.map((b) => (
        <g key={b.owner}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={`im-band${b.owner === ROUTE_OWNER ? " route" : ""}`} />
          <text x={b.x + 10} y={b.y + 16} className="im-band-name">
            {ownerLabel(b.owner)}
          </text>
        </g>
      ))}
      {box.fold && <FoldBox box={box.fold} serverId={box.id} hidden={srv.hidden ?? 0} />}
    </g>
  );
}

export function MapGroupBox({ g }: { g: PlacedGroup }) {
  return (
    <g>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={8} className="im-group" />
      <text x={g.x + g.w - 6} y={g.y + 10} className="im-group-name" textAnchor="end">
        {g.name}
      </text>
    </g>
  );
}
