// Mini gráfica de CPU y memoria de los últimos minutos (0–100 %).
import { type HistoryPoint, HISTORY_MS } from "../../features/fleet/health";

const W = 100;
const H = 30;

function path(points: HistoryPoint[], pick: (p: HistoryPoint) => number | null, end: number): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    const v = pick(p);
    if (v === null) {
      pen = false;
      continue;
    }
    const x = W - ((end - p.at) / HISTORY_MS) * W;
    const y = H - (Math.min(100, Math.max(0, v)) / 100) * (H - 2) - 1;
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  }
  return d;
}

export function Sparkline({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return <div className="fl-spark fl-spark-empty">Gráfica en unos segundos…</div>;
  const end = points[points.length - 1].at;
  return (
    <div className="fl-spark-box">
      <svg className="fl-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="CPU y memoria de los últimos 10 minutos">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="fl-spark-grid" />
        <path d={path(points, (p) => p.mem, end)} className="fl-spark-mem" />
        <path d={path(points, (p) => p.cpu, end)} className="fl-spark-cpu" />
      </svg>
      <div className="fl-spark-legend">
        <span className="cpu">CPU</span>
        <span className="mem">Memoria</span>
        <span>últimos 10 min</span>
      </div>
    </div>
  );
}
