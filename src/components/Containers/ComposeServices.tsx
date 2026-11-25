// Tabla de servicios de un proyecto Compose: los del archivo y sus contenedores (o «Sin crear»).
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { stateText, stateTone, type Container } from "../../features/containers";

interface Props {
  /** Servicios del archivo (null = aún no leídos o error). */
  services: string[] | null;
  error: string | null;
  containers: Container[];
  canRun: boolean;
}

export function ComposeServices({ services, error, containers, canRun }: Props) {
  const rows = useMemo(() => {
    const names = new Set([...(services ?? []), ...containers.map((c) => c.composeService ?? "").filter(Boolean)]);
    const list = [...names].sort().map((s) => ({ name: s, containers: containers.filter((c) => c.composeService === s) }));
    for (const c of containers) if (!c.composeService) list.push({ name: c.name, containers: [c] });
    return list;
  }, [services, containers]);

  return (
    <>
      <h4 className="section-label">Servicios</h4>
      {error && (
        <div className="ct-error ct-error-inline" role="alert">
          <AlertTriangle size={14} />
          <pre>{error}</pre>
        </div>
      )}
      <table className="ct-table ct-table-auto">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Contenedor</th>
            <th>Estado</th>
            <th>Imagen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) =>
            s.containers.length === 0 ? (
              <tr key={s.name}>
                <td className="ct-strong">{s.name}</td>
                <td className="faint">—</td>
                <td className="faint">
                  <span className="ct-cell-flex">
                    <span className="ct-dot ct-off" /> Sin crear
                  </span>
                </td>
                <td />
              </tr>
            ) : (
              s.containers.map((c) => (
                <tr key={c.id}>
                  <td className="ct-strong">{s.name}</td>
                  <td className="mono">{c.name}</td>
                  <td title={c.status}>
                    <span className="ct-cell-flex">
                      <span className={`ct-dot ct-${stateTone(c.state)}`} /> {stateText(c)}
                    </span>
                  </td>
                  <td className="mono faint ct-ellipsis">{c.image}</td>
                </tr>
              ))
            ),
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="ct-norows">
                {services === null && !error && canRun ? "Leyendo servicios…" : "Sin servicios"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
