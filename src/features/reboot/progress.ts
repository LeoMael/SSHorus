// Progreso de «Reiniciar ahora»: estados, transiciones y textos. Funciones puras (sin React ni Tauri).
//
//   sending ──orden aceptada──▶ going-down ──la conexión se cae──▶ waiting ──vuelve──▶ checking ──▶ done
//      │                           │                                  │                   │
//      └──────── error ────────────┴──── tiempo agotado / se cierra ──┴─▶ failed ◀── no se reinició
//   En cualquier momento antes del final: «Dejar de esperar» → stopped.
import type { RebootPending } from "./detect";
import { rebootedBetween, type ServerStatus } from "./commands";

export type RebootPhase = "sending" | "going-down" | "waiting" | "checking" | "done" | "failed" | "stopped";

/** Lo que espera el motor a que vuelva tras cortarse (s). */
export const REBOOT_WAIT_SECS = 300;
/** Si la conexión no se corta en este tiempo, el reinicio no llegó a hacerse. */
export const DOWN_LIMIT_MS = 3 * 60_000;
/** Red de seguridad por encima del plazo del motor (que avisa antes con la pestaña cerrada). */
export const BACK_LIMIT_MS = (REBOOT_WAIT_SECS + 30) * 1000;

export interface RebootRun {
  /** Servidor (host:puerto): un reinicio a la vez por servidor. */
  key: string;
  serverName: string;
  profileId: string;
  /** Conexión que se sigue (la del botón; otra si se reconecta a mano). */
  sessionId: string;
  phase: RebootPhase;
  startedAt: number;
  downAt: number | null;
  backAt: number | null;
  /** Estado antes de reiniciar (para saber si de verdad se reinició). */
  before: ServerStatus | null;
  after: ServerStatus | null;
  /** Motivo del fallo o aviso del resultado. */
  message: string | null;
  /** Falló porque la conexión se cerró: se puede reconectar a mano. */
  canReconnect: boolean;
  /** Reconexiones de la pestaña al empezar: si sube sin haber visto la caída, ya volvió. */
  reconnectsAtStart: number;
}

export type TabStatus = "connected" | "reconnecting" | "closed" | "gone";

export type RebootEvent =
  | { type: "sent" }
  | { type: "send-failed"; message: string }
  | { type: "tab"; status: TabStatus; reconnectCount: number; reason: string | null }
  | { type: "checked"; status: ServerStatus }
  | { type: "check-failed"; message: string }
  | { type: "reconnected-by-hand"; sessionId: string }
  | { type: "stop" }
  | { type: "tick" };

export function newRun(o: { key: string; serverName: string; profileId: string; sessionId: string; reconnectCount: number; before: ServerStatus | null }, now: number): RebootRun {
  return {
    key: o.key,
    serverName: o.serverName,
    profileId: o.profileId,
    sessionId: o.sessionId,
    phase: "sending",
    startedAt: now,
    downAt: null,
    backAt: null,
    before: o.before,
    after: null,
    message: null,
    canReconnect: false,
    reconnectsAtStart: o.reconnectCount,
  };
}

export function isActive(phase: RebootPhase): boolean {
  return phase === "sending" || phase === "going-down" || phase === "waiting" || phase === "checking";
}

function fail(run: RebootRun, message: string, canReconnect = false): RebootRun {
  return { ...run, phase: "failed", message, canReconnect };
}

function onTab(run: RebootRun, ev: Extract<RebootEvent, { type: "tab" }>, now: number): RebootRun {
  const { phase } = run;
  if (phase !== "sending" && phase !== "going-down" && phase !== "waiting") return run;
  switch (ev.status) {
    case "reconnecting":
      return phase === "waiting" ? run : { ...run, phase: "waiting", downAt: now };
    case "connected":
      // En «sending» la orden aún no respondió: seguir esperando a que lo haga.
      if (phase === "waiting" || (phase === "going-down" && ev.reconnectCount > run.reconnectsAtStart)) {
        return { ...run, phase: "checking", downAt: run.downAt ?? now, backAt: now };
      }
      return run;
    case "closed":
      return fail(run, ev.reason ? `Se perdió la conexión: ${ev.reason}` : "Se perdió la conexión con el servidor.", true);
    case "gone":
      return fail(run, "Se cerró la pestaña de este servidor.", true);
  }
}

export function rebootStep(run: RebootRun, ev: RebootEvent, now: number): RebootRun {
  switch (ev.type) {
    case "sent":
      return run.phase === "sending" ? { ...run, phase: "going-down" } : run;
    case "send-failed":
      return run.phase === "sending" ? fail(run, ev.message) : run;
    case "tab":
      return onTab(run, ev, now);
    case "checked": {
      if (run.phase !== "checking") return run;
      if (rebootedBetween(run.before, ev.status) === false) {
        return { ...fail(run, "La conexión se cortó, pero el servidor no se reinició."), after: ev.status };
      }
      return { ...run, phase: "done", after: ev.status, message: null };
    }
    case "check-failed":
      return run.phase === "checking" ? { ...run, phase: "done", message: `Volvió, pero no se pudo comprobar su estado: ${ev.message}` } : run;
    case "reconnected-by-hand":
      return run.phase === "failed" && run.canReconnect
        ? { ...run, phase: "checking", sessionId: ev.sessionId, backAt: now, downAt: run.downAt ?? now, message: null, canReconnect: false }
        : run;
    case "stop":
      return isActive(run.phase) ? { ...run, phase: "stopped" } : run;
    case "tick":
      if (run.phase === "going-down" && now - run.startedAt > DOWN_LIMIT_MS) {
        return fail(run, "La conexión sigue abierta: el servidor no se reinició (puede que algo lo esté bloqueando).");
      }
      if (run.phase === "waiting" && run.downAt !== null && now - run.downAt > BACK_LIMIT_MS) {
        return fail(run, "El servidor no volvió en 5 minutos.", true);
      }
      return run;
  }
}

const TITLE: Record<RebootPhase, string> = {
  sending: "Reiniciando…",
  "going-down": "Reiniciando…",
  waiting: "Esperando a que el servidor vuelva…",
  checking: "Conectado de nuevo. Comprobando…",
  done: "Reiniciado",
  failed: "El reinicio no se completó",
  stopped: "Se dejó de esperar",
};

export function phaseTitle(run: RebootRun): string {
  return TITLE[run.phase];
}

const PENDING_TEXT: Record<RebootPending, string> = {
  no: "Ya no hace falta reiniciar.",
  required: "El servidor sigue pidiendo reiniciar.",
  "kernel-gone": "El núcleo en marcha no es el instalado: sigue haciendo falta reiniciar.",
  unknown: "",
};

/** Texto del resultado: «Kernel en uso: X. Ya no hace falta reiniciar.» */
export function resultText(after: ServerStatus | null): string {
  if (!after) return "";
  const k = after.pending.kernel ? `Kernel en uso: ${after.pending.kernel}.` : "";
  return [k, PENDING_TEXT[after.pending.state]].filter(Boolean).join(" ");
}

/** Línea de detalle bajo el título. */
export function phaseDetail(run: RebootRun): string {
  switch (run.phase) {
    case "sending":
      return "Enviando la orden de reinicio.";
    case "going-down":
      return "El servidor se está apagando.";
    case "waiting":
      return "Suele tardar de 30 segundos a 2 minutos. Las pestañas de este servidor se reconectan solas.";
    case "checking":
      return "Mirando si aún falta reiniciar.";
    case "done":
      return [resultText(run.after), run.message].filter(Boolean).join(" ") || "El servidor volvió.";
    case "failed":
      return run.message ?? "";
    case "stopped":
      return "Las pestañas que no volvieron tienen el botón «Reconectar».";
  }
}

export const STEPS = ["Reiniciando", "Esperando a que vuelva", "Conectado de nuevo"] as const;
export type StepState = "done" | "current" | "todo" | "error";

/** Estado de cada paso de `STEPS` (el que falló, en «error»). */
export function stepStates(run: RebootRun): StepState[] {
  if (run.phase === "done") return STEPS.map(() => "done");
  const reached = run.backAt !== null ? 2 : run.downAt !== null ? 1 : 0;
  const bad = run.phase === "failed" || run.phase === "stopped";
  return STEPS.map((_, i) => (i < reached ? "done" : i === reached ? (bad ? "error" : "current") : "todo"));
}

/** ¿Sigue haciendo falta reiniciar tras el reinicio? (para el aviso del resultado) */
export function stillPending(run: RebootRun): boolean {
  const s = run.after?.pending.state;
  return run.phase === "done" && (s === "required" || s === "kernel-gone");
}

/** «0:42», «12:05». */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Servidor de un perfil: host (sin mayúsculas) y puerto. Dos perfiles con el mismo son el mismo servidor. */
export function serverKey(p: { host: string; port: number }): string {
  return `${p.host.trim().toLowerCase()}:${p.port || 22}`;
}
