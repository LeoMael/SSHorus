// Tablas de detalle del informe de tráfico: rutas más visitadas, IPs, orígenes (Referer) y últimas peticiones.
import { formatBytes, formatDate } from "../../../lib/format";
import type { TrafficReport } from "../../../features/admin";

export type TrafficSubTab = "paths" | "ips" | "refs" | "recent";

function statusClass(code: number): string {
  if (code >= 500) return "wt-code wt-code-5xx";
  if (code >= 400) return "wt-code wt-code-4xx";
  if (code >= 300) return "wt-code wt-code-3xx";
  return "wt-code wt-code-2xx";
}

export function WebTrafficTables({ report, tab }: { report: TrafficReport; tab: TrafficSubTab }) {
  if (tab === "paths") {
    if (report.topPaths.length === 0) return <div className="muted">Sin rutas registradas en este periodo.</div>;
    return (
      <div className="wt-table-wrap">
        <table className="wt-table">
          <caption className="wt-sr-only">Rutas más visitadas</caption>
          <thead>
            <tr>
              <th scope="col">Ruta</th>
              <th scope="col" className="wt-num">Peticiones</th>
              <th scope="col" className="wt-num">Errores</th>
              <th scope="col" className="wt-num">Transferido</th>
            </tr>
          </thead>
          <tbody>
            {report.topPaths.map((r) => (
              <tr key={r.path}>
                <td className="mono wt-path" title={r.path}>{r.path}</td>
                <td className="wt-num">{r.count.toLocaleString("es-ES")}</td>
                <td className="wt-num">{r.errors > 0 ? r.errors.toLocaleString("es-ES") : "—"}</td>
                <td className="wt-num">{formatBytes(r.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "ips") {
    if (report.topIps.length === 0) return <div className="muted">Sin direcciones IP registradas en este periodo.</div>;
    return (
      <div className="wt-table-wrap">
        <table className="wt-table">
          <caption className="wt-sr-only">IPs más activas</caption>
          <thead>
            <tr>
              <th scope="col">Dirección IP</th>
              <th scope="col" className="wt-num">Peticiones</th>
              <th scope="col" className="wt-num">Errores</th>
            </tr>
          </thead>
          <tbody>
            {report.topIps.map((r) => (
              <tr key={r.ip}>
                <td className="mono">{r.ip}</td>
                <td className="wt-num">{r.count.toLocaleString("es-ES")}</td>
                <td className="wt-num">{r.errors > 0 ? r.errors.toLocaleString("es-ES") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "refs") {
    if (report.topReferrers.length === 0) return <div className="muted">Sin orígenes externos (visitas directas o sin cabecera Referer).</div>;
    return (
      <div className="wt-table-wrap">
        <table className="wt-table">
          <caption className="wt-sr-only">Principales orígenes externos</caption>
          <thead>
            <tr>
              <th scope="col">Dominio de origen</th>
              <th scope="col" className="wt-num">Visitas</th>
            </tr>
          </thead>
          <tbody>
            {report.topReferrers.map((r) => (
              <tr key={r.host}>
                <td className="mono">{r.host}</td>
                <td className="wt-num">{r.count.toLocaleString("es-ES")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (report.recent.length === 0) return <div className="muted">Sin peticiones recientes en este periodo.</div>;
  return (
    <div className="wt-table-wrap">
      <table className="wt-table">
        <caption className="wt-sr-only">Últimas peticiones registradas</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Estado</th>
            <th scope="col">Método y ruta</th>
            <th scope="col">IP</th>
            <th scope="col" className="wt-num">Tamaño</th>
            <th scope="col">Cliente</th>
          </tr>
        </thead>
        <tbody>
          {report.recent.map((r, i) => (
            <tr key={`${r.ts}-${i}`}>
              <td className="mono">{formatDate(r.ts)}</td>
              <td><span className={statusClass(r.status)}>{r.status}</span></td>
              <td className="mono wt-path" title={`${r.method} ${r.path}`}>{r.method} {r.path}</td>
              <td className="mono">{r.ip || "—"}</td>
              <td className="wt-num">{formatBytes(r.bytes)}</td>
              <td className="wt-ua" title={r.ua}>{r.ua || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
