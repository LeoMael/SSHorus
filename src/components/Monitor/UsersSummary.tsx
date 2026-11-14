// «Por usuario»: cuánto usa cada usuario del servidor (CPU, memoria, procesos y contenedores). Pulsar
// una fila filtra la tabla de procesos por ese usuario.
import { formatBytes } from "../../lib/format";
import type { UserUsage } from "../../features/monitor";
import { fmtPct } from "./format";
import "./MonitorUsers.css";

interface UsersSummaryProps {
  users: UserUsage[];
  myUid: number | null;
  /** Usuario elegido en el filtro (null = todos). */
  selected: number | null;
  onSelect: (uid: number | null) => void;
}

export function UsersSummary({ users, myUid, selected, onSelect }: UsersSummaryProps) {
  const anyContainers = users.some((u) => u.containers > 0);
  return (
    <div className="mon-table-wrap">
      <table className="mon-table mon-users" aria-label="Consumo por usuario">
        <thead>
          <tr>
            <th className="mon-name">Usuario</th>
            <th className="mon-num" title="Parte del CPU de todo el servidor (todos los núcleos = 100 %)">
              CPU
            </th>
            <th className="mon-num">Memoria</th>
            <th className="mon-num">Procesos</th>
            {anyContainers && (
              <th className="mon-num" title="Contenedores en marcha que lanzó cada usuario (Podman o Docker)">
                Contenedores
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const pickable = u.uid !== null;
            const on = pickable && selected === u.uid;
            const toggle = () => pickable && onSelect(on ? null : u.uid);
            return (
              <tr key={u.uid ?? "?"} className={on ? "mon-users-on" : undefined} onClick={toggle}>
                <td className="mon-name">
                  {pickable ? (
                    <button
                      className="mon-users-pick"
                      aria-pressed={on}
                      title={on ? "Ver los procesos de todos" : `Ver solo los procesos de ${u.user}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                    >
                      {u.user}
                    </button>
                  ) : (
                    <span className="muted" title="Aún no se sabe de quién son">
                      Sin identificar
                    </span>
                  )}
                  {u.uid !== null && u.uid === myUid && <span className="mon-tag">tú</span>}
                </td>
                <td className="mon-num mono">
                  <span className="mon-users-cpu">
                    <span className="mon-users-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, u.cpuPct ?? 0)}%` }} />
                    </span>
                    {u.cpuPct === null ? "—" : fmtPct(u.cpuPct)}
                  </span>
                </td>
                <td className="mon-num mono">
                  {formatBytes(u.rssKb * 1024)}
                  {u.memPct !== null && <span className="muted"> · {fmtPct(u.memPct)}</span>}
                </td>
                <td className="mon-num mono">{u.procs}</td>
                {anyContainers && <td className="mon-num mono">{u.containers || "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
