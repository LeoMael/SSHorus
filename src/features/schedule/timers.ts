// Timers de systemd: lectura de `systemctl show` (bloques «Clave=valor» separados por una línea vacía),
// su horario en palabras y sus cambios (activar, desactivar, ejecutar ahora). Funciones puras.
import { shQuote } from "../../lib/remote";
import type { ConfigChange } from "../serverConfig";

export interface Timer {
  unit: string;
  description: string;
  /** Lo que lanza («dnf-makecache.service»). */
  activates: string | null;
  active: boolean;
  /** enabled, disabled, static… */
  boot: string;
  next: string | null;
  last: string | null;
  /** Horario en palabras («Cada día a las 0:00», «15 min después de encender»…). */
  when: string;
}

/** Valor vacío o «n/a» = no hay. */
const val = (v: string | undefined) => (v && v !== "n/a" && v !== "0" ? v : null);

/** `systemctl show … -p …` de varios timers. */
export function parseTimers(lines: string[]): Timer[] {
  const blocks: Record<string, string>[] = [];
  let cur: Record<string, string> = {};
  for (const line of lines) {
    if (!line.trim()) {
      if (Object.keys(cur).length) blocks.push(cur);
      cur = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) cur[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (Object.keys(cur).length) blocks.push(cur);
  return blocks
    .filter((b) => b.Id?.endsWith(".timer"))
    .map((b) => ({
      unit: b.Id,
      description: b.Description ?? "",
      activates: val(b.Unit),
      active: b.ActiveState === "active",
      boot: b.UnitFileState || "?",
      next: val(b.NextElapseUSecRealtime),
      last: val(b.LastTriggerUSec),
      when: timerWhen(b.TimersCalendar ?? "", b.TimersMonotonic ?? ""),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

const DOW: Record<string, string> = { Mon: "lunes", Tue: "martes", Wed: "miércoles", Thu: "jueves", Fri: "viernes", Sat: "sábados", Sun: "domingos" };

/** «*-*-* 03:00:00» → «Cada día a las 3:00»; si no se reconoce, el texto tal cual. */
export function calendarText(spec: string): string {
  const s = spec.trim();
  const m = /^(?:([A-Z][a-z]{2}(?:(?:,|\.\.)[A-Z][a-z]{2})*)\s+)?\*-\*-(\*|\d{1,2})\s+(\*|\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(s);
  if (!m) return s;
  const [, dow, day, hour, min] = m;
  const time = hour === "*" ? (min === "00" ? "cada hora, en punto" : `cada hora, en el minuto ${Number(min)}`) : `a las ${Number(hour)}:${min.padStart(2, "0")}`;
  let when = "cada día";
  if (dow) when = dow.includes("..") ? `de ${dow.split("..").map((d) => DOW[d] ?? d).join(" a ")}` : `los ${dow.split(",").map((d) => DOW[d] ?? d).join(", ")}`;
  if (day !== "*") when = `el día ${Number(day)} de cada mes`;
  const text = hour === "*" ? (when === "cada día" ? time : `${time}, ${when}`) : `${when} ${time}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONO: Record<string, string> = {
  OnBootUSec: "después de encender",
  OnStartupUSec: "después de arrancar systemd",
  OnUnitActiveUSec: "después de la última vez",
  OnUnitInactiveUSec: "después de que termine la última vez",
  OnActiveUSec: "después de activarlo",
};

/** «{ OnCalendar=… ; next_elapse=… }» y «{ OnBootUSec=15min ; … }» en palabras. */
export function timerWhen(calendar: string, monotonic: string): string {
  const parts: string[] = [];
  for (const m of calendar.matchAll(/OnCalendar=([^;}]+)/g)) parts.push(calendarText(m[1]));
  for (const m of monotonic.matchAll(/(On[A-Za-z]+USec)=([^;}\s]+)/g)) parts.push(`${m[2]} ${MONO[m[1]] ?? m[1]}`);
  return parts.length ? parts.join(" · ") : "—";
}

const TIMER_RE = /^[A-Za-z0-9:_.@\\-]+\.timer$/;
const SERVICE_RE = /^[A-Za-z0-9:_.@\\-]+\.service$/;

export type TimerAction = "enable" | "disable" | "run";

const TIMER_ACTIONS: Record<TimerAction, { title: (t: Timer) => string; explain: string; steps: (t: Timer) => string[] | null; danger: boolean }> = {
  enable: {
    title: (t) => `Activar ${t.unit}`,
    explain: "Lo activa ahora y en cada arranque: lanzará su tarea según su horario.",
    steps: (t) => [`systemctl enable --now ${shQuote(t.unit)}`],
    danger: false,
  },
  disable: {
    title: (t) => `Desactivar ${t.unit}`,
    explain: "Lo para y deja de arrancar solo: su tarea no se lanzará más hasta que lo vuelvas a activar.",
    steps: (t) => [`systemctl disable --now ${shQuote(t.unit)}`],
    danger: false,
  },
  run: {
    title: (t) => `Ejecutar ahora ${t.activates ?? t.unit}`,
    explain: "Lanza ya la tarea del timer, sin esperar a su hora (el horario sigue igual).",
    steps: (t) => (t.activates && SERVICE_RE.test(t.activates) ? [`systemctl start ${shQuote(t.activates)}`] : null),
    danger: false,
  },
};

/** Acciones que tienen sentido para el timer. */
export function timerActions(t: Timer): TimerAction[] {
  const out: TimerAction[] = [];
  if (t.boot !== "static" && t.boot !== "masked") out.push(t.active ? "disable" : "enable");
  if (t.activates) out.push("run");
  return out;
}

export function timerChange(t: Timer, a: TimerAction): ConfigChange | null {
  if (!TIMER_RE.test(t.unit)) return null;
  const row = TIMER_ACTIONS[a];
  const steps = row.steps(t);
  if (!steps) return null;
  return { id: `timer:${t.unit}:${a}`, label: row.title(t), title: row.title(t), explain: row.explain, steps, danger: row.danger, note: null, guardCheck: null, timeoutSecs: a === "run" ? 600 : 60 };
}
