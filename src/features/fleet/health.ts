// Estado de cada VPS en el panel y las reglas que se calculan con él: avisos, historial corto y espera
// entre reintentos. Funciones puras.
import type { AttentionKind } from "../multirun/types";
import { fullestDisk, type ProbeResult } from "./probe";

export type VpsStatus =
  /** Aún no se leyó (o en espera de su turno). */
  | "waiting"
  | "connecting"
  | "online"
  /** No responde: se reintenta solo, cada vez con más espera. */
  | "offline"
  /** Pide contraseña, código, frase o confirmar la huella: espera a que el usuario pulse «Conectar». */
  | "attention";

export interface HistoryPoint {
  at: number;
  cpu: number | null;
  mem: number | null;
}

export interface VpsLive {
  status: VpsStatus;
  /** Perfil con el que se lee. */
  profileId: string | null;
  sessionId: string | null;
  /** La sesión la abrió el panel (se cierra al cerrarlo). */
  owned: boolean;
  probe: ProbeResult | null;
  cpuPct: number | null;
  /** Lo que tardó en responder la última lectura (ms). */
  latencyMs: number | null;
  /** Hora de la última lectura buena. */
  at: number | null;
  history: HistoryPoint[];
  message: string | null;
  attention: AttentionKind | null;
  /** Fallos seguidos (para la espera creciente). */
  failures: number;
  /** Cuándo toca la próxima lectura (ms). */
  nextAt: number;
}

export const emptyLive = (): VpsLive => ({
  status: "waiting",
  profileId: null,
  sessionId: null,
  owned: false,
  probe: null,
  cpuPct: null,
  latencyMs: null,
  at: null,
  history: [],
  message: null,
  attention: null,
  failures: 0,
  nextAt: 0,
});

/** Minutos de historial que se guardan (en memoria) para la mini gráfica. */
export const HISTORY_MS = 10 * 60_000;
/** Espera máxima entre reintentos de un VPS que no responde. */
export const MAX_RETRY_MS = 5 * 60_000;

/** Espera antes del reintento n.º `failures` (1, 2, 3…): el intervalo, el doble, el cuádruple… hasta 5 min. */
export function retryDelayMs(failures: number, intervalMs: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(MAX_RETRY_MS, intervalMs * 2 ** (n - 1));
}

export function pushHistory(hist: readonly HistoryPoint[], p: HistoryPoint, keepMs = HISTORY_MS): HistoryPoint[] {
  return [...hist.filter((h) => p.at - h.at <= keepMs && h.at < p.at), p];
}

export type WarningLevel = "bad" | "warn";

export interface Warning {
  level: WarningLevel;
  text: string;
}

export const DISK_LIMIT = 90;
export const MEM_LIMIT = 90;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Avisos de la tarjeta, de más grave a menos. */
export function warnings(live: Pick<VpsLive, "status" | "probe">): Warning[] {
  if (live.status === "offline") return [{ level: "bad", text: "Sin conexión" }];
  const p = live.probe;
  if (!p || live.status !== "online") return [];
  const out: Warning[] = [];
  const disk = fullestDisk(p.disks);
  if (disk && disk.pct > DISK_LIMIT) out.push({ level: "bad", text: `Disco al ${disk.pct} % (${disk.mount})` });
  if (p.mem && p.mem.usedPct > MEM_LIMIT) out.push({ level: "bad", text: `Memoria al ${Math.round(p.mem.usedPct)} %` });
  if (p.failedUnits?.length) out.push({ level: "bad", text: `${plural(p.failedUnits.length, "servicio caído", "servicios caídos")}` });
  const ctFailed = p.containers?.failed.length ?? 0;
  if (ctFailed) out.push({ level: "bad", text: `${plural(ctFailed, "contenedor caído", "contenedores caídos")}` });
  if (p.rebootRequired) out.push({ level: "warn", text: "Reinicio pendiente" });
  return out;
}

/** El peor nivel de la tarjeta (para el borde de color); null = todo bien. */
export function worstLevel(ws: readonly Warning[]): WarningLevel | null {
  if (ws.some((w) => w.level === "bad")) return "bad";
  return ws.length ? "warn" : null;
}

/** Segundos → «3 d 4 h», «5 h 12 min», «8 min». */
export function formatUptime(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs) || secs < 0) return "—";
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
