// Textos de las pestañas de la barra (funciones puras, sin React).
import type { SessionTab } from "../../stores/tabs";
import type { LocalTab } from "../../features/localterm/store";

export const STATUS_LABEL: Record<SessionTab["status"], string> = {
  connected: "Conectado",
  reconnecting: "Reconectando",
  closed: "Desconectado",
};

type TabStatusInfo = Pick<SessionTab, "title" | "status" | "closedReason" | "reconnect">;

export function tabTooltip(t: TabStatusInfo): string {
  if (t.status === "closed") return `${t.title} — conexión perdida${t.closedReason ? `: ${t.closedReason}` : ""}`;
  if (t.status === "reconnecting") {
    const r = t.reconnect;
    return `${t.title} — reconectando${r ? ` (intento ${r.attempt} de ${r.maxAttempts})` : ""}${r?.reason ? `: ${r.reason}` : ""}`;
  }
  return t.title;
}

export function localTooltip(t: Pick<LocalTab, "kind" | "title" | "cwd" | "status">): string {
  const what = t.kind === "shell" ? "Terminal de este equipo" : `${t.title} (en este equipo)`;
  return `${what}${t.cwd ? ` — ${t.cwd}` : ""}${t.status === "exited" ? " — terminado" : ""}`;
}

/** Clases de una pestaña: las condiciones falsas no cuentan. */
export function tabClass(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
