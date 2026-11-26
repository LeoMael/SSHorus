// Pestaña «Monitor»: CPU, memoria, red, carga, discos, procesos y contenedores del servidor, en vivo.
// Solo muestrea mientras se ve (o cada 30 s en segundo plano si hay alertas activas).
import { useCallback, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import "./Monitor.css";
import "./MonitorCharts.css";
import "./MonitorTables.css";
import { useTabs } from "../../stores/tabs";
import { INTERVALS, loadPrefs, savePrefs, useSessionMonitor, type MonitorPrefs } from "../../features/monitor";
import { AlertsDialog } from "./AlertsDialog";
import { Summary } from "./Summary";
import { ServerView } from "./ServerView";
import { alertsAriaLabel, alertsTooltip, monitorStatus } from "./panelText";
import { useAlertConfig, useMonitorDemand, useWindowVisible } from "./useMonitorDemand";

export interface MonitorPanelProps {
  sessionId: string;
  profileId: string;
  /** La pestaña se ve. */
  active: boolean;
  /** Sin conexión. */
  disabled: boolean;
}

export function MonitorPanel({ sessionId, profileId, active, disabled }: MonitorPanelProps) {
  const visible = useWindowVisible();
  const [prefs, setPrefsState] = useState<MonitorPrefs>(loadPrefs);
  const alertCfg = useAlertConfig(profileId);
  const mon = useSessionMonitor(sessionId);
  const title = useTabs((s) => s.tabs.find((t) => t.sessionId === sessionId)?.title ?? "este servidor");
  const [alertsOpen, setAlertsOpen] = useState(false);

  const setPrefs = useCallback((p: Partial<MonitorPrefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      return next;
    });
  }, []);

  const live = active && visible && !disabled;
  const hasEngine = !!(mon?.info?.docker || mon?.info?.podman);
  const wantContainers = live && prefs.view === "server" && prefs.containers && hasEngine;
  useMonitorDemand({ sessionId, profileId, live, disabled, prefs, alertsEnabled: alertCfg.enabled, wantContainers });

  const alerts = mon?.alerts ?? [];
  const m = mon?.metrics ?? null;

  return (
    <div className="mon-root">
      <div className="mon-header">
        <div className="mon-seg" role="radiogroup" aria-label="Qué mostrar">
          <button
            role="radio"
            aria-checked={prefs.view === "server"}
            className={prefs.view === "server" ? "active" : ""}
            onClick={() => setPrefs({ view: "server" })}
          >
            Este servidor
          </button>
          <button
            role="radio"
            aria-checked={prefs.view === "all"}
            className={prefs.view === "all" ? "active" : ""}
            onClick={() => setPrefs({ view: "all" })}
          >
            Todas las conexiones
          </button>
        </div>
        <div className="mon-header-spacer" />
        <span className="mon-status faint" aria-live="polite">
          {monitorStatus(disabled, mon?.error, m?.at ?? null)}
          {mon?.loading && <span className="mon-pulse" aria-hidden="true" />}
        </span>
        {prefs.view === "server" && (
          <label className="mon-interval">
            <span className="muted">Cada</span>
            <select
              className="select"
              value={prefs.interval}
              onChange={(e) => setPrefs({ interval: Number(e.target.value) })}
              aria-label="Intervalo de actualización"
            >
              {INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {iv / 1000} s
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="icon-btn mon-bell"
          onClick={() => setAlertsOpen(true)}
          title={alertsTooltip(alerts, alertCfg.enabled)}
          aria-label={alertsAriaLabel(alerts.length)}
        >
          {alertCfg.enabled ? <Bell size={15} /> : <BellOff size={15} />}
          {alerts.length > 0 && <span className="mon-bell-dot" aria-hidden="true" />}
        </button>
      </div>

      <div className="mon-body">
        {prefs.view === "all" ? (
          <Summary currentSessionId={sessionId} live={live} />
        ) : (
          <ServerView
            sessionId={sessionId}
            profileId={profileId}
            mon={mon}
            prefs={prefs}
            setPrefs={setPrefs}
            live={live}
            disabled={disabled}
            hasEngine={hasEngine}
            diskLimit={alertCfg.disk.pct}
          />
        )}
      </div>

      <AlertsDialog
        open={alertsOpen}
        profileId={profileId}
        serverName={title}
        active={alerts}
        onClose={() => setAlertsOpen(false)}
      />
    </div>
  );
}
