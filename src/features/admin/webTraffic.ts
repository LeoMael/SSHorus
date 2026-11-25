// Análisis de tráfico / visitas de un sitio (Caddy JSON, nginx combined o journald de Caddy).
// Diseñado para servidores pequeños (1 vCPU): 100 % bajo demanda, prioridad mínima (`nice -n 19` +
// `ionice -c3`), tope de 8 MiB leídos desde el final (también de los rotados, ver webTrafficPy.ts) y límite
// de 15 s. Devuelve un JSON compacto (~4 KB). Funciones puras.
import { shQuote } from "../../lib/remote";
import type { Site } from "./web";
import { PY_ANALYZER } from "./webTrafficPy";

export type TrafficRange = "24h" | "7d" | "30d";

export interface TrafficQuery {
  range: TrafficRange;
  excludeStatic: boolean;
  excludeBots: boolean;
  /** Si el log está en journald (Caddy sin archivo) y el usuario pide leerlo. */
  useJournal?: boolean;
}

export interface TrafficBucket {
  label: string;
  ts: number;
  requests: number;
  errors: number;
}

export interface TrafficPathRow {
  path: string;
  count: number;
  errors: number;
  bytes: number;
}

export interface TrafficIpRow {
  ip: string;
  count: number;
  errors: number;
}

export interface TrafficRefRow {
  host: string;
  count: number;
}

export interface TrafficRecentRow {
  ts: number;
  method: string;
  path: string;
  status: number;
  ip: string;
  bytes: number;
  ua: string;
}

export interface TrafficReport {
  range: TrafficRange;
  totalRequests: number;
  uniqueIps: number;
  totalBytes: number;
  staticSkipped: number;
  botSkipped: number;
  status: { s2xx: number; s3xx: number; s4xx: number; s5xx: number };
  buckets: TrafficBucket[];
  topPaths: TrafficPathRow[];
  topIps: TrafficIpRow[];
  topReferrers: TrafficRefRow[];
  recent: TrafficRecentRow[];
  meta: {
    source: string;
    fileSize: number;
    scannedBytes: number;
    truncated: boolean;
    linesRead: number;
    /** Archivos rotados (`.1`, `.gz`…) leídos además del actual. */
    rotatedFiles: number;
    engine: "python3" | "awk";
    sharedLog: boolean;
    hostFiltered: boolean;
    note: string | null;
  };
}

/** Tope de bytes que se leen desde el final del log (8 MiB): rápido y seguro en 1 vCPU. */
export const MAX_LOG_BYTES = 8 * 1024 * 1024;

export const RANGE_SECS: Record<TrafficRange, number> = {
  "24h": 24 * 3600,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
};

/** Construye el script POSIX que ejecuta el análisis con prioridad mínima (`nice`/`ionice`) y tope de tiempo. */
export function trafficScript(site: Site, q: TrafficQuery): string {
  const log = site.accessLog;
  const journal = !!q.useJournal || (log?.format === "journal" && !log.path);
  const path = log?.path ?? "";
  const mode = journal ? "journal" : "file";
  const hosts = site.names.filter((h) => h && !h.includes("*")).join(",");
  const pyArgs = `${shQuote(mode)} ${shQuote(path)} ${shQuote(q.range)} ${shQuote(hosts)} ${q.excludeStatic ? "1" : "0"} ${q.excludeBots ? "1" : "0"} ${MAX_LOG_BYTES}`;
  const sinceArg = q.range === "24h" ? "24 hours ago" : q.range === "7d" ? "7 days ago" : "30 days ago";

  return [
    "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
    "LOW='nice -n 19'",
    "command -v ionice >/dev/null 2>&1 && LOW='ionice -c3 nice -n 19'",
    "TO=''; command -v timeout >/dev/null 2>&1 && TO='timeout 15'",
    "echo @@traffic",
    "if command -v python3 >/dev/null 2>&1; then",
    "  py=$(mktemp)",
    "  trap 'rm -f \"$py\"' EXIT",
    "  cat <<'__SSHORUS_PY__' > \"$py\"",
    PY_ANALYZER,
    "__SSHORUS_PY__",
    journal
      ? `  if command -v journalctl >/dev/null 2>&1; then $TO $LOW journalctl -u caddy --since ${shQuote(sinceArg)} --no-pager -o cat 2>/dev/null | $TO $LOW python3 "$py" ${pyArgs}; else echo '{"error":"journalctl no está disponible en este servidor"}'; fi`
      : `  $TO $LOW python3 "$py" ${pyArgs}`,
    "else",
    `  echo '{"error":"Hace falta python3 en el servidor para analizar los logs de visitas"}'`,
    "fi",
    "echo @@end",
  ].join("\n");
}

/** Interpreta la salida de `trafficScript`. Lanza Error con mensaje legible si el script falló. */
export function parseTraffic(stdout: string, sharedLog: boolean): TrafficReport {
  const m = /@@traffic\r?\n([\s\S]*?)\r?\n@@end/.exec(stdout);
  const raw = (m ? m[1] : stdout).trim();
  if (!raw) throw new Error("El servidor no devolvió datos de tráfico.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`No se pudo leer el resumen de tráfico: ${raw.slice(0, 200)}`);
  }
  if (typeof data.error === "string" && data.error) throw new Error(data.error);
  const report = data as unknown as TrafficReport;
  return {
    ...report,
    meta: {
      ...report.meta,
      sharedLog,
    },
  };
}
