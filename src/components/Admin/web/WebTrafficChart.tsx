// Gráfica de barras de tráfico por hora o por día, acompañada de una tabla semántica desplegable
// como alternativa accesible para lectores de pantalla.
import type { TrafficBucket, TrafficRange } from "../../../features/admin";

const TITLE: Record<TrafficRange, string> = {
  "24h": "Actividad por hora (últimas 24 h)",
  "7d": "Actividad diaria (últimos 7 días)",
  "30d": "Actividad diaria (últimos 30 días)",
};

function showLabel(i: number, total: number, range: TrafficRange): boolean {
  if (range === "7d") return true;
  if (i === 0 || i === total - 1) return true;
  const step = range === "24h" ? 4 : 5;
  return i % step === 0;
}

export function WebTrafficChart({ buckets, range }: { buckets: TrafficBucket[]; range: TrafficRange }) {
  const maxReq = Math.max(1, ...buckets.map((b) => b.requests));
  const peak = buckets.reduce<TrafficBucket | null>(
    (best, b) => (!best || b.requests > best.requests ? b : best),
    null,
  );
  const nonEmpty = buckets.filter((b) => b.requests > 0);

  return (
    <figure className="wt-chart-fig">
      <figcaption className="wt-chart-head">
        <span className="wt-chart-title">{TITLE[range]}</span>
        {peak && peak.requests > 0 && (
          <span className="wt-chart-peak">
            Pico: {peak.requests.toLocaleString("es-ES")} ({peak.label})
          </span>
        )}
        <span className="adm-spacer" />
        <span className="wt-status-legend">
          <span>
            <span className="wt-dot wt-seg-3xx" aria-hidden="true" />
            Peticiones
          </span>
          <span>
            <span className="wt-dot wt-seg-5xx" aria-hidden="true" />
            Errores 4xx/5xx
          </span>
        </span>
      </figcaption>

      <div className="wt-bars" aria-hidden="true">
        {buckets.map((b, i) => {
          const pct = b.requests > 0 ? Math.max(4, Math.round((b.requests / maxReq) * 100)) : 0;
          const errPct = b.requests > 0 && b.errors > 0 ? Math.max(8, Math.round((b.errors / b.requests) * 100)) : 0;
          const tip = `${b.label}: ${b.requests.toLocaleString("es-ES")} peticiones${b.errors > 0 ? ` · ${b.errors.toLocaleString("es-ES")} errores` : ""}`;
          return (
            <div key={b.ts} className="wt-bar-col" title={tip}>
              <div className="wt-bar-track">
                <div className={b.requests > 0 ? "wt-bar" : "wt-bar empty"} style={b.requests > 0 ? { height: `${pct}%` } : undefined}>
                  {errPct > 0 && <div className="wt-bar-err" style={{ height: `${errPct}%` }} />}
                </div>
              </div>
              <span className="wt-bar-lbl">{showLabel(i, buckets.length, range) ? b.label : ""}</span>
            </div>
          );
        })}
      </div>

      <details className="wt-chart-details">
        <summary>Ver datos en tabla ({nonEmpty.length} tramos con actividad)</summary>
        <div className="wt-table-wrap">
          <table className="wt-table">
            <caption className="wt-sr-only">{TITLE[range]}</caption>
            <thead>
              <tr>
                <th scope="col">{range === "24h" ? "Hora" : "Día"}</th>
                <th scope="col" className="wt-num">Peticiones</th>
                <th scope="col" className="wt-num">Errores (4xx/5xx)</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.ts}>
                  <td className="mono">{b.label}</td>
                  <td className="wt-num">{b.requests.toLocaleString("es-ES")}</td>
                  <td className="wt-num">{b.errors.toLocaleString("es-ES")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
