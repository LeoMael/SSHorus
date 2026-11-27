// Sub-pestaña «Servicios»: los servicios del sistema (systemd u OpenRC) o los `--user` de un usuario, con
// su estado (activo, caído, parado), si arrancan solos al encender, su registro y los botones para
// arrancar, parar, reiniciar o activarlos. Cada cambio enseña antes su comando exacto.
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ScrollText, Server } from "lucide-react";
import type { ConfigChange } from "../../../features/serverConfig";
import {
  actionsFor,
  countStates,
  lingerChange,
  loadSystemServices,
  loadUserServices,
  matchService,
  serviceChange,
  SERVICES_JOB,
  systemServices,
  userKey,
  userServices,
  type LogTarget,
  type Service,
} from "../../../features/services";
import { useAdmin } from "../context";
import { ConfigChangeDialog } from "../config/ConfigChangeDialog";
import { useTabRead } from "../useTabRead";
import { ServiceLogsDialog } from "./ServiceLogsDialog";
import { ServicesTable } from "./ServicesTable";
import { ServicesToolbar, type StateFilter } from "./ServicesToolbar";
import "../audit/AuditFix.css";
import "../AdminOps.css";

const SYSTEM = "";

export function ServicesTab() {
  const { sessionId, elevation, disabled } = useAdmin();
  const sys = systemServices.useEntry(sessionId);
  const [scope, setScope] = useState(SYSTEM);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StateFilter>("all");
  const [change, setChange] = useState<ConfigChange | null>(null);
  const [logs, setLogs] = useState<LogTarget | null>(null);
  const data = sys.data;
  const user = scope ? (data?.humans.find((h) => h.name === scope) ?? null) : null;
  const usr = userServices.useEntry(userKey(sessionId, scope));

  const loadSystem = useCallback(() => void loadSystemServices(sessionId, elevation), [sessionId, elevation]);
  const loadUser = useCallback(() => {
    if (user?.runtimeDir) void loadUserServices(sessionId, elevation, user, data?.me ?? null);
  }, [sessionId, elevation, user, data?.me]);
  const reload = useCallback(() => (user ? loadUser() : loadSystem()), [user, loadUser, loadSystem]);
  useTabRead({ sessionId, jobKind: SERVICES_JOB, hasData: !!data, elevatedData: true, disabled, elevation, load: reload });

  const pick = (name: string) => {
    setScope(name);
    const h = data?.humans.find((x) => x.name === name);
    if (h?.runtimeDir && !userServices.get(userKey(sessionId, name)).data) void loadUserServices(sessionId, elevation, h, data?.me ?? null);
  };

  const list = useMemo(() => (user ? (usr.data?.services ?? []) : (data?.services ?? [])), [user, usr.data, data]);
  const counts = useMemo(() => countStates(list), [list]);
  const rows = useMemo(() => list.filter((s) => (filter === "all" || s.state === filter) && matchService(s, query)), [list, filter, query]);
  const init = data?.init ?? "none";

  const act = (s: Service, a: ReturnType<typeof actionsFor>[number]) => {
    if (init === "none") return;
    setChange(serviceChange(s, a, { init, user }));
  };
  const openLogs = (s: Service) => {
    if (init !== "none") setLogs({ init, unit: s.unit, user });
  };

  const loading = user ? usr.loading : sys.loading;
  const error = user ? usr.error ?? usr.data?.error ?? null : sys.error;

  return (
    <div className="adm-pane svc-root">
      <ServicesToolbar
        humans={data?.humans ?? []}
        me={data?.me ?? null}
        scope={scope}
        onScope={pick}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        loading={loading}
        disabled={disabled}
        onReload={reload}
      />
      {error && (
        <div className="adm-banner adm-banner-warn" role="alert">
          <AlertTriangle size={14} />
          <span className="adm-banner-text">{error}</span>
        </div>
      )}
      {!data ? (
        <div className="empty-state">
          {sys.loading ? <span className="spinner" /> : <Server size={22} />}
          <div>{sys.loading ? "Leyendo los servicios…" : "Servicios del servidor"}</div>
        </div>
      ) : init === "none" ? (
        <div className="empty-state">
          <Server size={22} />
          <div>No aplica: este servidor no usa systemd ni OpenRC (o no arrancó con ellos, como pasa en un contenedor).</div>
        </div>
      ) : user && init !== "systemd" ? (
        <div className="empty-state">
          <div>No aplica: los servicios por usuario son cosa de systemd.</div>
        </div>
      ) : user && !user.runtimeDir ? (
        <div className="empty-state">
          <div>{user.name} no tiene su gestor de servicios en marcha (no tiene sesión abierta ni «linger»): sus servicios no se pueden ver ahora.</div>
          <button className="btn btn-sm" onClick={() => setChange(lingerChange(user))} disabled={disabled}>
            Mantener en marcha sus servicios (linger)…
          </button>
        </div>
      ) : (
        <ServicesTable rows={rows} init={init} user={user} onAction={act} onLogs={openLogs} />
      )}
      {data && (
        <div className="adm-statusbar">
          {init === "openrc" ? "OpenRC" : "systemd"} · {list.length} servicios · {counts.failed} caídos
          {user ? ` · de ${user.name}` : ""}
          {loading && <RefreshCw size={11} className="adm-spin" />}
          <span className="adm-spacer" />
          <ScrollText size={11} /> Doble clic: ver su registro
        </div>
      )}
      {change && <ConfigChangeDialog change={change} kind={SERVICES_JOB} area="Servicios" onClose={() => setChange(null)} />}
      {logs && <ServiceLogsDialog target={logs} me={data?.me ?? null} onClose={() => setLogs(null)} />}
    </div>
  );
}
