// Cifras de un VPS leído: medidores, carga, tiempo encendido, contenedores, servicios y actualizaciones.
import { DISK_LIMIT, MEM_LIMIT, formatUptime, type VpsLive } from "../../features/fleet/health";
import { fullestDisk, type ProbeResult } from "../../features/fleet/probe";
import { Sparkline } from "./Sparkline";

function Meter({ label, pct, limit, detail }: { label: string; pct: number | null; limit: number; detail?: string }) {
  const level = pct === null ? "" : pct > limit ? " bad" : pct > limit - 15 ? " warn" : "";
  return (
    <div className="fl-meter" title={detail}>
      <span className="fl-meter-label">{label}</span>
      <div className="fl-bar">
        <div className={`fl-bar-fill${level}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className={`fl-meter-val${level}`}>{pct === null ? "—" : `${Math.round(pct)} %`}</span>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function containersText(p: ProbeResult): { text: string; bad: boolean } | null {
  const c = p.containers;
  if (!c) return null;
  if (c.error) return { text: `no se pudieron leer (${c.engines.join(", ")})`, bad: false };
  if (c.running + c.stopped === 0) return { text: "ninguno", bad: false };
  const parts = [`${c.running} en marcha`];
  if (c.failed.length) parts.push(plural(c.failed.length, "caído", "caídos"));
  const quiet = c.stopped - c.failed.length;
  if (quiet) parts.push(plural(quiet, "parado", "parados"));
  return { text: parts.join(" · "), bad: c.failed.length > 0 };
}

export function VpsMetrics({ live }: { live: VpsLive }) {
  const p = live.probe;
  if (!p) return null;
  const disk = fullestDisk(p.disks);
  const ct = containersText(p);
  const units = p.failedUnits;
  const ctFailed = p.containers?.failed ?? [];
  return (
    <>
      <div className="fl-meters">
        <Meter label="CPU" pct={live.cpuPct} limit={101} />
        <Meter label="Memoria" pct={p.mem?.usedPct ?? null} limit={MEM_LIMIT} />
        <Meter label={disk ? `Disco ${disk.mount}` : "Disco"} pct={disk?.pct ?? null} limit={DISK_LIMIT} detail={p.disks.map((d) => `${d.mount}: ${d.pct} %`).join("\n")} />
      </div>
      <Sparkline points={live.history} />
      <dl className="fl-facts">
        <dt>Carga</dt>
        <dd title="Media de 1, 5 y 15 minutos">
          {p.load ? p.load.map((x) => x.toFixed(2)).join(" · ") : "—"}
          {p.nproc ? <span className="faint"> ({plural(p.nproc, "CPU", "CPU")})</span> : null}
        </dd>
        <dt>Encendido</dt>
        <dd>{formatUptime(p.uptimeSecs)}</dd>
        {ct && (
          <>
            <dt>Contenedores</dt>
            <dd className={ct.bad ? "fl-bad" : undefined} title={ctFailed.length ? `Caídos: ${ctFailed.join(", ")}` : undefined}>
              {ct.text}
            </dd>
          </>
        )}
        {units && (
          <>
            <dt>Servicios</dt>
            <dd className={units.length ? "fl-bad" : undefined} title={units.join("\n") || undefined}>
              {units.length ? `${plural(units.length, "caído", "caídos")}: ${units.slice(0, 3).join(", ")}${units.length > 3 ? "…" : ""}` : "todos bien"}
            </dd>
          </>
        )}
        {(p.updates !== null || p.rebootRequired !== null) && (
          <>
            <dt>Sistema</dt>
            <dd>
              {[
                p.updates !== null ? (p.updates ? plural(p.updates, "actualización", "actualizaciones") : "al día") : null,
                p.rebootRequired ? "reinicio pendiente" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "sin reinicio pendiente"}
            </dd>
          </>
        )}
      </dl>
    </>
  );
}
