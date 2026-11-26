// «Servicios que puedes traer»: lo que escucha en el servidor (sobre todo lo que solo se ve desde dentro)
// con un botón para traerlo a tu PC con un túnel. Con sudo se ve qué programa usa cada puerto; sin él, se
// adivina por el número.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { errorMessage } from "../../api/core";
import { tunnels, type TunnelDef, type TunnelStatus } from "../../api/tunnels";
import { useProfiles } from "../../stores/profiles";
import { toast } from "../../stores/toasts";
import { usePrivilege, useElevation, useStoredSudo } from "../../features/privileges";
import { discoverServices, proposeLocalPorts, type Discovery } from "../../features/tunnels/discover";
import { findLocalTunnel, serviceTitle, type FoundService } from "../../features/tunnels/detect";
import { groupByCategory } from "../../features/tunnels/categories";
import { openLocalTunnel } from "../../features/tunnels/openLocal";
import { useTunnels } from "../../features/tunnels/useTunnels";
import { ServiceGroup } from "./ServiceGroup";
import { ServiceRow } from "./ServiceRow";
import "./Services.css";

const SudoDialog = lazy(() => import("../Sudo/SudoDialog").then((m) => ({ default: m.SudoDialog })));

const NO_STATUS: Record<string, TunnelStatus> = {};
const NO_DEFS: TunnelDef[] = [];

export interface ServicesSectionProps {
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
}

export function ServicesSection({ sessionId, profileId, active, disabled }: ServicesSectionProps) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  const elevation = elev.elevation;
  useStoredSudo(sessionId, profileId, info, active && !disabled);
  const defs = useTunnels((s) => s.defs[profileId]) ?? NO_DEFS;
  const statusMap = useTunnels((s) => s.status[sessionId]) ?? NO_STATUS;
  const sshPort = useProfiles((s) => s.servers.find((x) => x.id === profileId)?.port ?? 22);

  const [found, setFound] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [sudoOpen, setSudoOpen] = useState(false);
  const [stale, setStale] = useState(true);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const d = await discoverServices(sessionId, elevation, sshPort);
      if (g === gen.current) setFound(d);
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [sessionId, elevation, sshPort]);

  // Volver a leer al reconectar o al cambiar la elevación (p. ej. tras escribir la contraseña de sudo).
  const elevKey = elevation?.kind ?? "none";
  useEffect(() => setStale(true), [elevKey, disabled]);
  useEffect(() => {
    if (!active || disabled || !info || !stale) return;
    setStale(false);
    void load();
  }, [active, disabled, info, stale, load]);

  const existing = useCallback((s: FoundService) => findLocalTunnel(defs, s.destHost, s.port), [defs]);

  useEffect(() => {
    if (!found) return;
    let alive = true;
    proposeLocalPorts(found.services, defs, existing).then(
      (p) => alive && setPorts(p),
      () => alive && setPorts({}),
    );
    return () => {
      alive = false;
    };
  }, [found, defs, existing]);

  const bring = async (s: FoundService) => {
    setBusy((b) => ({ ...b, [s.key]: true }));
    await openLocalTunnel(sessionId, profileId, s.destHost, s.port, serviceTitle(s), ports[s.key]);
    setBusy((b) => ({ ...b, [s.key]: false }));
  };

  const stop = async (def: TunnelDef) => {
    try {
      await tunnels.stop(sessionId, def.id);
      await useTunnels.getState().loadStatus(sessionId);
    } catch (e) {
      toast.error(`No se pudo parar «${def.name}»`, e);
    }
  };

  const groups = useMemo(() => groupByCategory(found?.services ?? []), [found]);
  const guessing = !!found && !found.elevated && found.services.some((s) => s.procs.length === 0 && !s.container);

  const row = (s: FoundService) => {
    const def = existing(s);
    return (
      <ServiceRow
        key={s.key}
        item={s}
        def={def}
        status={def ? statusMap[def.id] : undefined}
        proposed={ports[s.key]}
        busy={!!busy[s.key]}
        disabled={disabled}
        onBring={() => void bring(s)}
        onStop={(d) => void stop(d)}
      />
    );
  };

  return (
    <section className="tn-svcs" aria-label="Servicios que puedes traer">
      <div className="tn-svcs-head">
        <span className="section-label">Servicios que puedes traer</span>
        <button className="icon-btn" title="Volver a buscar" disabled={disabled || loading} onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? "tn-spin" : undefined} />
        </button>
      </div>

      {disabled ? (
        <p className="tn-svcs-note faint">Conéctate para ver qué servicios tiene el servidor.</p>
      ) : error ? (
        <div className="tn-banner tn-banner-error">No se pudo leer el servidor: {error}</div>
      ) : !found ? (
        <div className="tn-loading">
          <div className="spinner" />
        </div>
      ) : found.services.length === 0 ? (
        <p className="tn-svcs-note faint">No se encontró nada que traer (solo los servicios del sistema, como SSH).</p>
      ) : (
        <>
          {guessing && (
            <div className="tn-svcs-sudo">
              <span>Sin sudo no se ve qué programa usa cada puerto: se adivina por el número.</span>
              {elev.canAskSudo && (
                <button className="btn btn-sm" onClick={() => setSudoOpen(true)}>
                  <KeyRound size={13} /> Usar sudo
                </button>
              )}
            </div>
          )}
          {groups.map((g) => (
            <ServiceGroup key={g.category.id} group={g} alone={groups.length === 1} row={row} />
          ))}
        </>
      )}

      {sudoOpen && (
        <Suspense fallback={null}>
          <SudoDialog sessionId={sessionId} profileId={profileId} user={info?.user ?? null} onClose={() => setSudoOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
