// Lo que el panel del Monitor pide al motor de muestreo: cada cuánto muestrear y si leer contenedores.
// Solo muestrea mientras se ve (o cada 30 s en segundo plano si hay alertas activas).
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  BACKGROUND_INTERVAL,
  loadAlerts,
  onAlertsChanged,
  setContainersDemand,
  setSampleDemand,
  type AlertConfig,
  type MonitorPrefs,
} from "../../features/monitor";

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const getVisible = () => document.visibilityState !== "hidden";

/** La ventana se ve (no está minimizada ni en otra pestaña del sistema). */
export function useWindowVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getVisible);
}

export function useAlertConfig(profileId: string): AlertConfig {
  const [cfg, setCfg] = useState(() => loadAlerts(profileId));
  useEffect(() => {
    setCfg(loadAlerts(profileId));
    return onAlertsChanged((p) => {
      if (p === profileId) setCfg(loadAlerts(profileId));
    });
  }, [profileId]);
  return cfg;
}

interface DemandArgs {
  sessionId: string;
  profileId: string;
  live: boolean;
  disabled: boolean;
  prefs: MonitorPrefs;
  alertsEnabled: boolean;
  wantContainers: boolean;
}

export function useMonitorDemand({ sessionId, profileId, live, disabled, prefs, alertsEnabled, wantContainers }: DemandArgs) {
  const owner = `panel:${sessionId}`;

  useEffect(() => {
    let iv: number | null = null;
    if (!disabled) {
      if (live && prefs.view === "server") iv = prefs.interval;
      else if (alertsEnabled) iv = BACKGROUND_INTERVAL;
    }
    setSampleDemand(sessionId, profileId, owner, iv);
  }, [sessionId, profileId, owner, live, disabled, prefs.view, prefs.interval, alertsEnabled]);

  useEffect(() => {
    setContainersDemand(sessionId, profileId, owner, wantContainers);
  }, [sessionId, profileId, owner, wantContainers]);

  useEffect(
    () => () => {
      setSampleDemand(sessionId, profileId, owner, null);
      setContainersDemand(sessionId, profileId, owner, false);
    },
    [sessionId, profileId, owner],
  );
}
