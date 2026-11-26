// Mapa de un proyecto: todos sus servidores conectados en un mismo lienzo (con las conexiones entre ellos).
// Como el de un servidor, se guarda: al reabrirlo se ve al instante (ver useCachedMap).
import { useEffect } from "react";
import { Plug, Waypoints, X } from "lucide-react";
import { connectToMany } from "../../features/connect";
import { collectServer } from "../../features/infra/collect";
import type { NavTarget, ServerSnapshot } from "../../features/infra";
import { closeProjectMap, useInfraNav, useProjectMap } from "../../features/infra/store";
import { useProfiles } from "../../stores/profiles";
import { useTabs, type SessionTab } from "../../stores/tabs";
import { InfraMapView } from "./InfraMapView";
import { useCachedMap } from "./useCachedMap";

function offline(id: string, name: string, host: string): ServerSnapshot {
  return {
    id,
    name,
    host,
    sessionId: null,
    error: null,
    offline: true,
    elevated: false,
    me: null,
    ports: null,
    web: null,
    containers: [],
    extra: null,
    userServices: {},
    notes: ["sin conexión"],
  };
}

/** Última pestaña conectada a ese servidor. */
function liveTab(tabs: SessionTab[], profileId: string): SessionTab | undefined {
  return tabs.filter((t) => t.profileId === profileId && t.status === "connected").slice(-1)[0];
}

export function ProjectMap() {
  const projectId = useProjectMap((s) => s.projectId);
  const preset = useProjectMap((s) => s.preset);
  const project = useProfiles((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const servers = useProfiles((s) => s.servers);
  const tabs = useTabs((s) => s.tabs);

  const members = (project?.serverIds ?? []).map((id) => servers.find((s) => s.id === id)).filter((s) => !!s);
  const sessionOf = (profileId: string) => liveTab(tabs, profileId)?.sessionId ?? null;
  const missing = members.filter((s) => !sessionOf(s.id));

  // Conectar o reconectar un servidor del proyecto cambia la clave: el mapa se relee.
  const token = members
    .map((s) => {
      const t = liveTab(tabs, s.id);
      return `${s.id}=${t ? `${t.sessionId}#${t.reconnectCount}` : "-"}`;
    })
    .join(",");
  const key = `project:${projectId ?? ""}`;
  const cached = useCachedMap({
    key,
    token,
    enabled: !preset && !!projectId,
    load: async () => {
      const { servers: all, projects } = useProfiles.getState();
      const p = projects.find((x) => x.id === projectId);
      const list = (p?.serverIds ?? []).map((id) => all.find((s) => s.id === id)).filter((s) => !!s);
      const live = useTabs.getState().tabs;
      return Promise.all(
        list.map((s) => {
          const sid = liveTab(live, s.id)?.sessionId;
          return sid ? collectServer({ profileId: s.id, name: s.name, host: s.host, sessionId: sid }) : Promise.resolve(offline(s.id, s.name, s.host));
        }),
      );
    },
  });
  const snaps = preset ?? cached.snapshots;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) closeProjectMap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nav = (serverId: string, t: NavTarget) => {
    const sid = snaps?.find((s) => s.id === serverId)?.sessionId ?? sessionOf(serverId);
    if (!sid) return;
    useTabs.getState().setActive(sid);
    closeProjectMap();
    useInfraNav.getState().open(sid, t);
  };

  const name = project?.name ?? "proyecto";
  return (
    <div className="im-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeProjectMap()}>
      <div className="im-panel" role="dialog" aria-modal="true" aria-label={`Mapa de ${name}`} tabIndex={-1}>
        <div className="im-panel-head">
          <Waypoints size={17} />
          <h2>Mapa · {name}</h2>
          <button className="icon-btn" onClick={closeProjectMap} title="Cerrar" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="im-panel-body">
          <InfraMapView
            key={preset ? "preset" : key}
            cacheKey={preset ? "project-preview" : key}
            snapshots={snaps}
            loading={!preset && cached.loading}
            updatedAt={preset ? null : cached.at}
            onRefresh={preset ? () => {} : cached.refresh}
            onNav={nav}
            name={`mapa-${name}`}
            extraTools={
              missing.length > 0 && !preset ? (
                <button
                  className="btn btn-sm"
                  onClick={() => void connectToMany(missing)}
                  title={missing.map((s) => s.name).join(", ")}
                >
                  <Plug size={13} /> Conectar ({missing.length})
                </button>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
