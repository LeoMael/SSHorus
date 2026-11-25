// «Por usuario»: cuánto usa cada usuario del servidor (CPU, memoria, procesos y contenedores). Pulsar
// una fila filtra la tabla de procesos por ese usuario. Los uid de los contenedores de Podman sin root
// salen debajo de su dueño, con el nombre del contenedor.
import { Box } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { userRowText, type UserUsage } from "../../features/monitor";
import { fmtPct } from "./format";
import "./MonitorUsers.css";

interface UsersSummaryProps {
  users: UserUsage[];
  myUid: number | null;
  /** /proc oculta los procesos de los demás y no se leyó con sudo. */
  hidepid: boolean;
  elevated: boolean;
  /** Usuario elegido en el filtro (null = todos). */
  selected: number | null;
  onSelect: (uid: number | null) => void;
}

export function UsersSummary({ users, myUid, hidepid, elevated, selected, onSelect }: UsersSummaryProps) {
  const anyContainers = users.some((u) => u.containers > 0);
  const anySub = users.some((u) => u.sub);
  return (
    <>
      <p className="mon-users-help muted">
        Pulsa una fila para ver solo sus procesos.
        {anySub && " Las filas con el icono de caja son usuarios de dentro de contenedores de Podman sin root."}
      </p>
      <div className="mon-table-wrap">
        <table className="mon-table mon-users" aria-label="Consumo por usuario">
          <thead>
            <tr>
              <th className="mon-name">Usuario</th>
              <th className="mon-num" title="Parte del CPU de todo el servidor (todos los núcleos = 100 %)">
                CPU
              </th>
              <th className="mon-num" title="Memoria en uso (RSS) y parte de la memoria total">
                Memoria
              </th>
              <th className="mon-num" title="Procesos en marcha">
                Procesos
              </th>
              {anyContainers && (
                <th className="mon-num" title="Contenedores en marcha que lanzó cada usuario (Podman o Docker)">
                  Contenedores
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const pickable = u.uid !== null;
              const on = pickable && selected === u.uid;
              const toggle = () => pickable && onSelect(on ? null : u.uid);
              const text = userRowText(u, { hidepid, elevated });
              // Bajo su dueño (la fila anterior es del mismo grupo): con sangría.
              const prev = users[i - 1];
              const nested = !!u.sub && !!prev && (prev.sub?.owner ?? prev.user) === u.sub.owner;
              const cls = [on && "mon-users-on", nested && "mon-users-sub"].filter(Boolean).join(" ") || undefined;
              return (
                <tr key={u.uid ?? "?"} className={cls} onClick={toggle}>
                  <td className="mon-name" title={text.hint}>
                    {u.sub && <Box size={12} className="mon-users-icon" aria-hidden="true" />}
                    {pickable ? (
                      <button
                        className="mon-users-pick"
                        aria-pressed={on}
                        title={on ? "Ver los procesos de todos" : text.hint}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                      >
                        {text.main}
                      </button>
                    ) : (
                      <span className="muted">{text.main}</span>
                    )}
                    {text.detail && <span className="muted mon-users-detail"> · {text.detail}</span>}
                    {u.uid !== null && u.uid === myUid && (
                      <>
                        {" "}
                        <span className="mon-tag">tú</span>
                      </>
                    )}
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
    </>
  );
}
