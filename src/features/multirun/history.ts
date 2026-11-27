// «Ejecutar en varios servidores» en el historial de cada servidor: una entrada por servidor al terminar.
// Lo puro (qué servidores acaban de terminar y cómo queda la entrada) se prueba en history.test.ts.
import type { NewHistoryEvent } from "../../api/serverHistory";
import { execResultText, firstLine, recordEvent, tail } from "../serverHistory";
import { isFinal, type RunSpec, type TargetState, type TargetStatus } from "./types";

const STATUS: Partial<Record<TargetStatus, string>> = {
  ok: "Bien",
  error: "Falló",
  timeout: "Se agotó el tiempo",
  canceled: "Cancelado",
};

/** Los que pasaron a un estado final entre `prev` y `next` (reintentar vuelve a contar). */
export function finishedNow(prev: readonly TargetState[], next: readonly TargetState[]): TargetState[] {
  const before = new Map(prev.map((t) => [t.profileId, t]));
  return next.filter((t) => {
    if (!isFinal(t.status)) return false;
    const p = before.get(t.profileId);
    return !p || !isFinal(p.status) || p.finishedAt !== t.finishedAt;
  });
}

export function multiRunEvent(spec: RunSpec, t: TargetState): NewHistoryEvent {
  const parts = [STATUS[t.status] ?? t.status, t.detail, t.result && execResultText(t.result)].filter(Boolean);
  return {
    source: "multirun",
    title: spec.label || firstLine(spec.command),
    detail: spec.command,
    ok: t.status === "ok",
    result: tail(parts.join("\n")),
    serverName: t.name,
  };
}

/** Guarda los que acaban de terminar. */
export function recordFinished(spec: RunSpec, prev: readonly TargetState[], next: readonly TargetState[]): void {
  for (const t of finishedNow(prev, next)) recordEvent(t.profileId, multiRunEvent(spec, t));
}
