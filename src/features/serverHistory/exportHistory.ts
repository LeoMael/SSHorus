// Exportar la línea de tiempo (lo que se ve, ya filtrado) a texto o JSON. Lógica pura.
import { SOURCE_LABEL, type TimelineItem } from "./timeline";

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const resultLabel = (ok: boolean | null) => (ok === null ? "—" : ok ? "bien" : "falló");

const indent = (s: string) =>
  s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

export function historyToText(items: TimelineItem[], serverName: string, now = Date.now()): string {
  const head = [`Historial de ${serverName}`, `Exportado el ${stamp(now)} · ${items.length} entrada${items.length === 1 ? "" : "s"}`, ""];
  const body = items.map((i) => {
    const lines = [`[${stamp(i.at)}] ${SOURCE_LABEL[i.source]} · ${i.who} · ${resultLabel(i.ok)}`, `  ${i.title}`];
    if (i.detail && i.detail !== i.title) lines.push(indent(i.detail));
    if (i.result) lines.push("  Resultado:", indent(i.result));
    return lines.join("\n");
  });
  return [...head, ...body].join("\n") + "\n";
}

export function historyToJson(items: TimelineItem[], serverName: string, now = Date.now()): string {
  const entries = items.map((i) => ({
    at: new Date(i.at).toISOString(),
    source: i.source,
    sourceLabel: SOURCE_LABEL[i.source],
    who: i.who,
    ok: i.ok,
    title: i.title,
    detail: i.detail,
    result: i.result,
  }));
  return JSON.stringify({ server: serverName, exportedAt: new Date(now).toISOString(), entries }, null, 2) + "\n";
}

/** Nombre de archivo sugerido: «historial-web-prod-2026-11-26.txt». */
export function exportFileName(serverName: string, ext: "txt" | "json", now = Date.now()): string {
  const safe = serverName.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "servidor";
  return `historial-${safe}-${stamp(now).slice(0, 10)}.${ext}`;
}
