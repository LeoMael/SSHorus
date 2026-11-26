// Pestaña «Administración» de una conexión: usuarios, grupos, sesiones abiertas, puertos, sitios web e
// historial de cambios.
// Lee como usuario normal; los cambios se ejecutan como root (directo, sudo -n/doas -n o sudo -S con la
// contraseña por stdin, guardada solo en memoria). Antes de cada cambio se muestra el comando exacto.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabs } from "../../stores/tabs";
import {
  buildUserRows,
  detectEnv,
  parsePorts,
  parseWeb,
  PORTS_SCRIPT,
  WEB_SCRIPT,
  useAdminHistory,
  type PortsResult,
  type WebResult,
} from "../../features/admin";
import { useElevation, usePrivilege, useStoredSudo, useStoredSudoState } from "../../features/privileges";
import { AdminContext, type AdminContextValue, type PortsFilter } from "./context";
import { AdminBanners, AdminHeader, type SubTab } from "./AdminChrome";
import { AdminBody } from "./AdminBody";
import { SudoDialog } from "./SudoDialog";
import { useVulnNav } from "../../features/vulnscan/nav";
import { useInfraNav } from "../../features/infra/store";
import { useElevatedScan } from "./useElevatedScan";
import { useServerRead } from "./useServerRead";
import { useAdminRunPlan } from "./useAdminRunPlan";
import "./Admin.css";
import "./AdminTable.css";
import "./AdminDialogs.css";
import "./users/AdminKeys.css";
import "./AdminHistory.css";
import "./web/AdminWeb.css";

export function AdminPanel({
  sessionId,
  profileId,
  active,
  disabled,
  onOpenFile,
}: {
  sessionId: string;
  profileId: string;
  active: boolean;
  disabled: boolean;
  /** Abre un archivo del servidor en el editor de la conexión. */
  onOpenFile?: (path: string) => void;
}) {
  const info = usePrivilege(sessionId);
  const elev = useElevation(sessionId, info);
  const elevation = elev.elevation;
  useStoredSudo(sessionId, profileId, info, active && !disabled);
  const serverName = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.title ?? "servidor");
  const ensureHistory = useAdminHistory((s) => s.ensure);

  const [tab, setTab] = useState<SubTab>("users");
  const vulnNav = useVulnNav((s) => s.request);
  useEffect(() => {
    if (vulnNav?.sessionId === sessionId) setTab("vulns");
  }, [vulnNav, sessionId]);
  const { read, shadow, loading, error, shadowError, load } = useServerRead(sessionId, elevation);
  const [sudoOpen, setSudoOpen] = useState<null | "ask" | "change">(null);
  const [stale, setStale] = useState(true);
  const storedSudo = useStoredSudoState(sessionId);
  useEffect(() => {
    if (storedSudo === "failed" && active && !disabled) setSudoOpen((o) => o ?? "ask");
  }, [storedSudo, active, disabled]);

  const [ports, loadPorts] = useElevatedScan<PortsResult>(sessionId, elevation, PORTS_SCRIPT, parsePorts, 20);
  const [web, loadWeb] = useElevatedScan<WebResult>(sessionId, elevation, WEB_SCRIPT, parseWeb, 40);
  const [scanStale, setScanStale] = useState({ ports: true, web: true });
  const [portsFilter, setPortsFilter] = useState<PortsFilter>({ query: "", scope: "all", proto: "all" });

  useEffect(() => ensureHistory(profileId), [ensureHistory, profileId]);

  const elevKey = elevation ? elevation.kind : "none";
  const prevElevKey = useRef(elevKey);
  useEffect(() => {
    if (prevElevKey.current !== elevKey) {
      prevElevKey.current = elevKey;
      setStale(true);
      setScanStale({ ports: true, web: true });
    }
  }, [elevKey]);
  useEffect(() => {
    if (disabled) {
      setStale(true);
      setScanStale({ ports: true, web: true });
    }
  }, [disabled]);
  useEffect(() => {
    if (active && !disabled && stale) {
      setStale(false);
      void load();
    }
  }, [active, disabled, stale, load]);
  useEffect(() => {
    if (!active || disabled) return;
    const needPorts = (tab === "ports" || tab === "web" || tab === "visibility") && scanStale.ports;
    const needWeb = tab === "web" && scanStale.web;
    if (!needPorts && !needWeb) return;
    setScanStale((s) => ({ ports: needPorts ? false : s.ports, web: needWeb ? false : s.web }));
    if (needPorts) void loadPorts();
    if (needWeb) void loadWeb();
  }, [active, disabled, tab, scanStale, loadPorts, loadWeb]);

  const env = useMemo(
    () => (read ? detectEnv(read.tools, info?.distroId ?? null, info?.distroLike ?? [], read.groups.map((g) => g.name)) : null),
    [read, info?.distroId, info?.distroLike],
  );
  const users = useMemo(() => (read ? buildUserRows(read, shadow) : []), [read, shadow]);
  const me = read?.me ?? info?.user ?? null;

  const runPlan = useAdminRunPlan({ sessionId, profileId, serverName, disabled, elevation, canAskSudo: elev.canAskSudo, reload: load });

  const askSudo = useCallback(() => setSudoOpen("ask"), []);
  const refresh = useCallback(() => void load(), [load]);
  const reloadPorts = useCallback(() => void loadPorts(), [loadPorts]);
  const reloadWeb = useCallback(() => void loadWeb(), [loadWeb]);
  const goToPort = useCallback((port: number) => {
    setPortsFilter({ query: `:${port}`, scope: "all", proto: "all" });
    setTab("ports");
  }, []);
  const openFile = onOpenFile ?? null;

  const infraNav = useInfraNav((s) => s.request);
  useEffect(() => {
    if (!infraNav || infraNav.sessionId !== sessionId || infraNav.target.kind === "containers") return;
    if (infraNav.target.kind === "ports") goToPort(infraNav.target.port);
    else setTab("web");
    useInfraNav.getState().done(infraNav.seq);
  }, [infraNav, sessionId, goToPort]);

  const refreshCurrent = () => {
    if (tab === "map") return;
    if (tab === "ports") reloadPorts();
    else if (tab === "web") {
      reloadPorts();
      reloadWeb();
    } else refresh();
  };
  const busy = tab === "ports" ? ports.loading : tab === "web" ? web.loading || ports.loading : loading;

  const ctx: AdminContextValue = useMemo(
    () => ({
      sessionId,
      profileId,
      serverName,
      disabled,
      info,
      elev,
      elevation,
      readOnly: !elevation || disabled,
      env,
      read,
      shadow,
      users,
      me,
      refresh,
      runPlan,
      askSudo,
      ports,
      loadPorts: reloadPorts,
      web,
      loadWeb: reloadWeb,
      portsFilter,
      setPortsFilter,
      goToPort,
      openFile,
    }),
    [
      sessionId, profileId, serverName, disabled, info, elev, elevation, env, read, shadow,
      users, me, refresh, runPlan, askSudo, ports, reloadPorts, web, reloadWeb, portsFilter, goToPort, openFile,
    ],
  );

  if (!active) return null;

  return (
    <AdminContext.Provider value={ctx}>
      <div className="adm-root">
        <AdminHeader
          sessionId={sessionId}
          tab={tab}
          setTab={setTab}
          read={read}
          info={info}
          elev={elev}
          elevation={elevation}
          disabled={disabled}
          busy={busy}
          onChangeSudo={() => setSudoOpen("change")}
          onRefresh={refreshCurrent}
        />
        <AdminBanners
          disabled={disabled}
          elevation={elevation}
          elev={elev}
          storedSudo={storedSudo}
          shadowError={shadowError}
          tab={tab}
          onAskSudo={askSudo}
        />

        <AdminBody
          tab={tab}
          setTab={setTab}
          sessionId={sessionId}
          profileId={profileId}
          active={active}
          disabled={disabled}
          hasRead={!!read}
          error={error}
          onRetry={refresh}
        />
        {sudoOpen && (
          <SudoDialog
            sessionId={sessionId}
            profileId={profileId}
            user={me}
            change={sudoOpen === "change"}
            onClose={() => setSudoOpen(null)}
          />
        )}
      </div>
    </AdminContext.Provider>
  );
}
