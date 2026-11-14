// Preferencias del Panel de VPS (agrupar y cada cuánto leer), comunes a todas sus pestañas.
import { create } from "zustand";
import type { FleetGroupBy } from "./group";

export const INTERVAL_CHOICES = [10, 15, 30, 60] as const;
const DEFAULT_INTERVAL = 15;
const PREFS_KEY = "sshorus.fleet.prefs";

interface FleetPrefs {
  groupBy: FleetGroupBy;
  intervalSecs: number;
}

function readPrefs(): FleetPrefs {
  const def: FleetPrefs = { groupBy: "project", intervalSecs: DEFAULT_INTERVAL };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    if (!v || typeof v !== "object") return def;
    const o = v as Partial<FleetPrefs>;
    return {
      groupBy: o.groupBy === "ip" ? "ip" : "project",
      intervalSecs: INTERVAL_CHOICES.includes(o.intervalSecs as (typeof INTERVAL_CHOICES)[number]) ? (o.intervalSecs as number) : DEFAULT_INTERVAL,
    };
  } catch {
    return def;
  }
}

export const useFleet = create<FleetPrefs>(() => readPrefs());

export function setFleetPrefs(p: Partial<FleetPrefs>): void {
  useFleet.setState(p);
  const { groupBy, intervalSecs } = useFleet.getState();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ groupBy, intervalSecs }));
  } catch {
    /* sin almacenamiento: vale para esta vez */
  }
}
