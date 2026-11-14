// Panel de VPS (contenido de su pestaña): una tarjeta por VPS (mismo host y puerto), agrupadas por
// proyecto o por IP. Las lecturas y las conexiones las lleva features/fleet/runtime.
import { memo, useEffect, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { groupVps, sections, type FleetGroupBy } from "../../features/fleet/group";
import { emptyLive } from "../../features/fleet/health";
import { ensureFleet, useFleetLive } from "../../features/fleet/runtime";
import { INTERVAL_CHOICES, setFleetPrefs, useFleet } from "../../features/fleet/store";
import { closeFleetTab, fleetTabTitle, openFleet, type FleetTab } from "../../features/fleet/tabs";
import { useProfiles } from "../../stores/profiles";
import { VpsCard } from "./VpsCard";
import "./Fleet.css";

const GROUPS: { id: FleetGroupBy; label: string }[] = [
  { id: "project", label: "Por proyecto" },
  { id: "ip", label: "Por IP" },
];

export const FleetPanel = memo(function FleetPanel({ tab }: { tab: FleetTab }) {
  const { groupBy, intervalSecs } = useFleet();
  const servers = useProfiles((s) => s.servers);
  const projects = useProfiles((s) => s.projects);
  const live = useFleetLive((s) => s.live);

  const project = tab.projectId ? (projects.find((p) => p.id === tab.projectId) ?? null) : null;
  const gone = !!tab.projectId && !project;
  const secs = useMemo(() => sections(groupVps(servers, projects), projects, groupBy, tab.projectId), [servers, projects, groupBy, tab.projectId]);

  useEffect(ensureFleet, []);
  // Se borró su proyecto: la pestaña ya no tiene nada que mostrar.
  useEffect(() => {
    if (gone) closeFleetTab(tab.id);
  }, [gone, tab.id]);

  const title = fleetTabTitle(tab, projects);
  return (
    <div className="fl-panel" role="tabpanel" aria-label={title}>
      <div className="fl-head">
        <LayoutDashboard size={17} />
        <h2>{title}</h2>
        {project && (
          <button className="btn btn-sm" onClick={() => openFleet(null)}>
            Ver todos los VPS
          </button>
        )}
        <div className="fl-seg" role="radiogroup" aria-label="Agrupar">
          {GROUPS.map((g) => (
            <button key={g.id} role="radio" aria-checked={groupBy === g.id} className={groupBy === g.id ? "on" : ""} onClick={() => setFleetPrefs({ groupBy: g.id })}>
              {g.label}
            </button>
          ))}
        </div>
        <label className="fl-interval" title="Cada cuánto se lee cada VPS">
          Cada
          <select className="select" value={intervalSecs} onChange={(e) => setFleetPrefs({ intervalSecs: Number(e.target.value) })}>
            {INTERVAL_CHOICES.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fl-body">
        {secs.length === 0 ? (
          <div className="empty-state">{project ? "Este proyecto no tiene servidores." : "No hay servidores guardados."}</div>
        ) : (
          secs.map((s) => (
            <section key={s.id} className="fl-section">
              {(secs.length > 1 || groupBy === "project") && (
                <h3 className="fl-section-title">
                  {s.color && <span className="fl-section-color" style={{ background: s.color }} />}
                  {s.title}
                  <span className="faint">{s.vps.length}</span>
                </h3>
              )}
              <div className="fl-grid">
                {s.vps.map((v) => (
                  <VpsCard key={v.key} v={v} live={live[v.key] ?? emptyLive()} />
                ))}
              </div>
            </section>
          ))
        )}
        <p className="fl-foot faint">
          Solo lee por SSH con comandos estándar (no instala nada) y solo mientras miras esta pestaña. Una conexión por VPS, que se
          cierra al cerrar la última pestaña del panel; si ya tienes una pestaña de ese VPS, usa la suya.
        </p>
      </div>
    </div>
  );
});
