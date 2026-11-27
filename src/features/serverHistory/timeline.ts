// La línea de tiempo de un servidor: junta en un solo tipo lo que se registra en cada sitio (Administración,
// asistente de IA, lo que guarda este historial, auditorías y escáner), la ordena y la filtra. Lógica pura.
import type { AuditEntry } from "../../api/mcp";
import type { AuditMeta } from "../../api/audit";
import type { ReportMeta } from "../../api/vulnscan";
import type { HistoryEvent, HistorySource } from "../../api/serverHistory";
import type { HistoryEntry } from "../admin/history";

export type TimelineSource = "admin" | "ai" | HistorySource | "audit" | "vulnscan";

export interface TimelineItem {
  key: string;
  at: number;
  source: TimelineSource;
  title: string;
  detail: string;
  /** null = no se sabe. */
  ok: boolean | null;
  /** Quién lo hizo: «Tú» o el asistente. */
  who: string;
  result: string;
}

/** Cada origen: su nombre en los filtros. El orden es el de los filtros. */
export const SOURCES: { id: TimelineSource; label: string }[] = [
  { id: "admin", label: "Administración" },
  { id: "ai", label: "Asistente de IA" },
  { id: "terminal", label: "Terminal" },
  { id: "library", label: "Biblioteca" },
  { id: "multirun", label: "Varios servidores" },
  { id: "job", label: "Tareas" },
  { id: "audit", label: "Auditorías" },
  { id: "vulnscan", label: "Escáner" },
];

export const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.id, s.label])) as Record<TimelineSource, string>;

const WHO: Record<HistorySource, string> = {
  terminal: "Tú (terminal)",
  library: "Tú (Biblioteca)",
  multirun: "Tú (varios servidores)",
  job: "Tú (tarea)",
};

const AI_STATUS: Record<AuditEntry["status"], { ok: boolean | null; label: string }> = {
  running: { ok: null, label: "En curso" },
  ok: { ok: true, label: "Hecho" },
  error: { ok: false, label: "Error" },
  denied: { ok: false, label: "Denegado" },
  locked: { ok: false, label: "SSHorus estaba bloqueado" },
};

export function fromAdmin(e: HistoryEntry): TimelineItem {
  return { key: `admin:${e.id}`, at: e.at, source: "admin", title: e.action, detail: e.command, ok: e.ok, who: "Tú", result: e.result };
}

export function fromAi(e: AuditEntry): TimelineItem {
  const st = AI_STATUS[e.status];
  const result = [st.label, e.approvedBy && `Aprobó: ${e.approvedBy}`, e.auto && "Aceptado sin preguntar", e.message].filter(Boolean).join("\n");
  return { key: `ai:${e.id}`, at: e.at, source: "ai", title: e.tool, detail: e.detail, ok: st.ok, who: e.client || "Asistente de IA", result };
}

export function fromEvent(e: HistoryEvent): TimelineItem {
  return { key: `ev:${e.id}`, at: e.at, source: e.source, title: e.title, detail: e.detail, ok: e.ok, who: WHO[e.source], result: e.result };
}

const parseDate = (s: string) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

export function fromAudit(m: AuditMeta): TimelineItem {
  const title = `Auditoría${m.grade ? `: nota ${m.grade}` : ""}${m.score !== null ? ` (${m.score}/100)` : ""}`;
  const detail = `${m.bad} problema${m.bad === 1 ? "" : "s"} y ${m.warn} aviso${m.warn === 1 ? "" : "s"}${m.elevated ? " · como root" : ""}`;
  return { key: `audit:${m.id}`, at: parseDate(m.createdAt), source: "audit", title, detail, ok: m.bad === 0, who: "Tú", result: "" };
}

export function fromVuln(m: ReportMeta): TimelineItem {
  const s = m.summary;
  const title = `Análisis de vulnerabilidades: ${s.total} encontrada${s.total === 1 ? "" : "s"}`;
  const detail = `Críticas ${s.critical} · altas ${s.high} · medias ${s.medium} · bajas ${s.low} · con arreglo ${s.withFix}${m.distro ? ` · ${m.distro}` : ""}`;
  return { key: `vuln:${m.id}`, at: parseDate(m.createdAt), source: "vulnscan", title, detail, ok: s.critical + s.high === 0, who: "Tú", result: "" };
}

/** Todo junto, lo más nuevo primero. */
export function mergeTimeline(lists: TimelineItem[][]): TimelineItem[] {
  return lists.flat().sort((a, b) => b.at - a.at);
}

export interface TimelineFilter {
  /** Orígenes que se ven (vacío = todos). */
  sources: ReadonlySet<TimelineSource>;
  text: string;
  onlyErrors: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filterTimeline(items: TimelineItem[], f: TimelineFilter): TimelineItem[] {
  const words = norm(f.text).split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f.sources.size && !f.sources.has(i.source)) return false;
    if (f.onlyErrors && i.ok !== false) return false;
    if (!words.length) return true;
    const hay = norm(`${i.title}\n${i.detail}\n${i.result}\n${i.who}\n${SOURCE_LABEL[i.source]}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Cuántas hay de cada origen (para los filtros). */
export function countBySource(items: TimelineItem[]): Partial<Record<TimelineSource, number>> {
  const out: Partial<Record<TimelineSource, number>> = {};
  for (const i of items) out[i.source] = (out[i.source] ?? 0) + 1;
  return out;
}
