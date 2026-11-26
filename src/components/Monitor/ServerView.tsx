// Vista «Este servidor» del Monitor: tarjetas, discos, procesos y contenedores.
import type { MonitorPrefs, SessionMonitor } from "../../features/monitor";
import { DiskBars } from "./DiskBars";
import { ProcessesSection } from "./ProcessesSection";
import { Containers } from "./Containers";
import { CpuCard, LoadCard, MemCard, NetCard } from "./MetricCards";

export interface ServerViewProps {
  sessionId: string;
  profileId: string;
  mon: SessionMonitor | null;
  prefs: MonitorPrefs;
  setPrefs: (p: Partial<MonitorPrefs>) => void;
  live: boolean;
  disabled: boolean;
  hasEngine: boolean;
  diskLimit: number;
}

export function ServerView({ sessionId, profileId, mon, prefs, setPrefs, live, disabled, hasEngine, diskLimit }: ServerViewProps) {
  const m = mon?.metrics ?? null;
  if (mon?.noProc) {
    return (
      <div className="empty-state">
        Este servidor no tiene /proc: el monitor solo funciona con servidores Linux.
      </div>
    );
  }
  if (!m) {
    if (disabled) return <div className="empty-state">Sin conexión</div>;
    return (
      <div className="empty-state">
        {mon?.error ? (
          <span className="mon-error">{mon.error}</span>
        ) : (
          <>
            <span className="spinner" /> Leyendo datos del servidor…
          </>
        )}
      </div>
    );
  }
  const history = mon?.history ?? [];
  return (
    <>
      <p className="mon-intro faint">
        Qué está usando el servidor ahora: CPU, memoria, red, disco y procesos (y quién los usa).
      </p>
      {mon?.error && <div className="mon-error mon-banner">No se pudo actualizar: {mon.error}</div>}
      <div className="mon-cards">
        <CpuCard m={m} history={history} />
        <MemCard m={m} history={history} />
        <NetCard m={m} history={history} />
        <LoadCard m={m} history={history} />
      </div>

      <section className="mon-section" aria-labelledby="mon-disks-h">
        <h3 id="mon-disks-h" className="section-label">
          Discos
        </h3>
        <DiskBars disks={m.disks} limit={diskLimit} />
      </section>

      {mon && (
        <ProcessesSection
          sessionId={sessionId}
          profileId={profileId}
          m={m}
          mon={mon}
          sort={prefs.procSort}
          onSort={(procSort) => setPrefs({ procSort })}
          live={live}
          disabled={disabled}
        />
      )}

      {hasEngine && (
        <section className="mon-section" aria-labelledby="mon-ct-h">
          <div className="mon-section-head">
            <h3 id="mon-ct-h" className="section-label">
              Contenedores
            </h3>
            <label className="checkbox mon-ct-toggle">
              <input type="checkbox" checked={prefs.containers} onChange={(e) => setPrefs({ containers: e.target.checked })} />
              Mostrar (cada 10 s)
            </label>
          </div>
          {prefs.containers && mon && <Containers state={mon.containers} />}
        </section>
      )}
    </>
  );
}
