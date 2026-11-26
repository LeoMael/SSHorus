// Tarjetas del Monitor (CPU, memoria, red y carga), cada una con su gráfica de los últimos 5 minutos.
import type { ReactNode } from "react";
import { formatBytes } from "../../lib/format";
import { HISTORY_MS, type Metrics, type SessionMonitor } from "../../features/monitor";
import { AreaChart, type ChartSeries } from "./AreaChart";
import { fmtLoad, fmtPct, fmtRate, fmtUptime } from "./format";

const CPU_SERIES: ChartSeries[] = [{ key: "cpu", label: "CPU", color: "--accent" }];
const MEM_SERIES: ChartSeries[] = [{ key: "mem", label: "Memoria", color: "--accent" }];
const NET_SERIES: ChartSeries[] = [
  { key: "rx", label: "Recibido", color: "--accent" },
  { key: "tx", label: "Enviado", color: "--orange" },
];
const LOAD_SERIES: ChartSeries[] = [{ key: "load", label: "Carga", color: "--accent" }];

interface CardProps {
  m: Metrics;
  history: SessionMonitor["history"];
}

function Card({ label, value, sub, children }: { label: string; value: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="mon-card">
      <div className="mon-card-label">{label}</div>
      <div className="mon-card-value">{value}</div>
      <div className="mon-card-sub muted" title={typeof sub === "string" ? sub : undefined}>
        {sub}
      </div>
      {children}
    </div>
  );
}

export function CpuCard({ m, history }: CardProps) {
  const extra = [
    m.nproc ? `${m.nproc} CPU` : null,
    m.iowaitPct !== null && m.iowaitPct >= 0.5 ? `espera de disco ${fmtPct(m.iowaitPct)}` : null,
    m.stealPct !== null && m.stealPct >= 0.5 ? `robado ${fmtPct(m.stealPct)}` : null,
  ].filter(Boolean);
  return (
    <Card label="CPU" value={m.cpuPct === null ? "—" : fmtPct(m.cpuPct)} sub={extra.join(" · ") || " "}>
      <AreaChart
        points={history}
        series={CPU_SERIES}
        windowMs={HISTORY_MS}
        max={100}
        format={fmtPct}
        ariaLabel={`Uso de CPU en los últimos 5 minutos. Ahora: ${m.cpuPct === null ? "sin dato" : fmtPct(m.cpuPct)}`}
      />
    </Card>
  );
}

export function MemCard({ m, history }: CardProps) {
  const mem = m.mem;
  const kb = (v: number) => formatBytes(v * 1024);
  const sub = mem
    ? `${kb(mem.usedKb)} de ${kb(mem.totalKb)} · caché ${kb(mem.cacheKb)}${mem.swapTotalKb > 0 ? ` · swap ${fmtPct(mem.swapPct)}` : ""}`
    : " ";
  return (
    <Card label="Memoria" value={mem ? fmtPct(mem.usedPct) : "—"} sub={sub}>
      <AreaChart
        points={history}
        series={MEM_SERIES}
        windowMs={HISTORY_MS}
        max={100}
        format={fmtPct}
        ariaLabel={`Memoria usada en los últimos 5 minutos. Ahora: ${mem ? fmtPct(mem.usedPct) : "sin dato"}`}
      />
    </Card>
  );
}

export function NetCard({ m, history }: CardProps) {
  const rx = m.net.rxRate;
  const tx = m.net.txRate;
  const ifaces = m.net.ifaces.filter((i) => !i.virtual);
  const busiest = [...ifaces].sort((a, b) => (b.rxRate ?? 0) + (b.txRate ?? 0) - ((a.rxRate ?? 0) + (a.txRate ?? 0)));
  const sub = busiest.length ? busiest.slice(0, 3).map((i) => i.iface).join(", ") : "Sin interfaces";
  return (
    <div className="mon-card">
      <div className="mon-card-label">Red</div>
      <div className="mon-card-value mon-net-value">
        <span>
          <span className="mon-key" style={{ background: "var(--accent)" }} aria-hidden="true" />↓ {rx === null ? "—" : fmtRate(rx)}
        </span>
        <span>
          <span className="mon-key" style={{ background: "var(--orange)" }} aria-hidden="true" />↑ {tx === null ? "—" : fmtRate(tx)}
        </span>
      </div>
      <div className="mon-card-sub muted" title={m.net.ifaces.map((i) => i.iface).join(", ")}>
        <span className="mon-legend">
          <span className="mon-key" style={{ background: "var(--accent)" }} aria-hidden="true" />
          Recibido
          <span className="mon-key" style={{ background: "var(--orange)" }} aria-hidden="true" />
          Enviado
        </span>
        {" · "}
        {sub}
      </div>
      <AreaChart
        points={history}
        series={NET_SERIES}
        windowMs={HISTORY_MS}
        format={fmtRate}
        ariaLabel={`Red en los últimos 5 minutos. Ahora: recibido ${rx === null ? "sin dato" : fmtRate(rx)}, enviado ${tx === null ? "sin dato" : fmtRate(tx)}`}
      />
    </div>
  );
}

export function LoadCard({ m, history }: CardProps) {
  const l = m.load;
  const sub = l
    ? `5 min ${fmtLoad(l[1])} · 15 min ${fmtLoad(l[2])}${m.uptime !== null ? ` · encendido ${fmtUptime(m.uptime)}` : ""}`
    : " ";
  return (
    <Card label="Carga (1 min)" value={l ? fmtLoad(l[0]) : "—"} sub={sub}>
      <AreaChart
        points={history}
        series={LOAD_SERIES}
        windowMs={HISTORY_MS}
        reference={m.nproc ? { value: m.nproc, label: `${m.nproc} CPU` } : undefined}
        format={fmtLoad}
        ariaLabel={`Carga del sistema en los últimos 5 minutos. Ahora: ${l ? fmtLoad(l[0]) : "sin dato"}${m.nproc ? ` con ${m.nproc} CPU` : ""}`}
      />
    </Card>
  );
}
