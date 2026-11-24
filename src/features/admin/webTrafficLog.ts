// Detección del archivo de registro de visitas (access log) por sitio, a partir de la configuración
// ya leída de nginx y Caddy (cero comandos SSH adicionales). Funciones puras.
import type { NgxDirective, Site } from "./web";

export type AccessLogFormat = "json" | "combined" | "journal" | "off";

export interface SiteAccessLog {
  /** Ruta del archivo de log en el servidor (null si va a journald o está desactivado). */
  path: string | null;
  format: AccessLogFormat;
  /** True si varios sitios comparten ese archivo o hereda el log global del servidor. */
  shared: boolean;
}

const DEFAULT_NGINX_ACCESS_LOG = "/var/log/nginx/access.log";

/** Última directiva `access_log` directa dentro de un bloque nginx (`http` o `server`). */
function nginxAccessLogOf(dirs: NgxDirective[]): { path: string | null; off: boolean } | null {
  const hits = dirs.filter((d) => d.name === "access_log" && !d.block && d.args.length > 0);
  if (hits.length === 0) return null;
  // Si hay alguna ruta activa (no «off»), tomamos la última ruta (nginx permite varias, excepto «off»).
  const last = hits[hits.length - 1];
  if (last.args[0] === "off") return { path: null, off: true };
  const active = [...hits].reverse().find((d) => d.args[0] && d.args[0] !== "off");
  if (!active) return { path: null, off: true };
  const raw = active.args[0];
  // syslog:… o rutas con variables ($host) no se leen como archivo plano.
  if (raw.startsWith("syslog:") || raw.includes("$")) return { path: null, off: false };
  return { path: raw, off: false };
}

/** Detecta el access_log de cada bloque `server {}` de nginx (heredando de `http {}` y marcando compartidos). */
export function detectNginxAccessLogs(http: NgxDirective[], serverBlocks: NgxDirective[][]): SiteAccessLog[] {
  const inherited = nginxAccessLogOf(http);
  const raw: SiteAccessLog[] = serverBlocks.map((b) => {
    const own = nginxAccessLogOf(b);
    if (own) {
      if (own.off) return { path: null, format: "off", shared: false };
      return { path: own.path, format: own.path ? "combined" : "off", shared: false };
    }
    if (inherited?.off) return { path: null, format: "off", shared: false };
    const path = inherited ? inherited.path : DEFAULT_NGINX_ACCESS_LOG;
    return { path, format: path ? "combined" : "off", shared: true };
  });
  return markSharedPaths(raw);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A qué archivo o destino escribe un logger de Caddy (`cfg.logging.logs[name]`). */
function caddyLoggerTarget(loggingLogs: Json, loggerName: string): { path: string | null; format: AccessLogFormat } {
  const entry = isObj(loggingLogs[loggerName]) ? (loggingLogs[loggerName] as Json) : null;
  const writer = entry && isObj(entry.writer) ? (entry.writer as Json) : null;
  if (writer?.output === "file" && typeof writer.filename === "string" && writer.filename.trim()) {
    return { path: writer.filename.trim(), format: "json" };
  }
  if (writer?.output === "discard") return { path: null, format: "off" };
  // Sin writer=file (stdout/stderr por defecto): queda en el journal de systemd (`journalctl -u caddy`).
  return { path: null, format: "journal" };
}

/** Detecta el log de acceso de cada sitio de Caddy a partir del JSON completo (`cfg`). */
export function detectCaddyAccessLogs(cfg: unknown, sites: Site[]): Map<string, SiteAccessLog> {
  const out = new Map<string, SiteAccessLog>();
  const servers = isObj(cfg) && isObj(cfg.apps) && isObj(cfg.apps.http) && isObj(cfg.apps.http.servers) ? cfg.apps.http.servers : {};
  const loggingLogs = isObj(cfg) && isObj(cfg.logging) && isObj(cfg.logging.logs) ? (cfg.logging.logs as Json) : {};
  const entries: { key: string; log: SiteAccessLog }[] = [];

  for (const site of sites) {
    const srvName = site.key.split("|")[1] ?? "";
    const srv = isObj(servers[srvName]) ? (servers[srvName] as Json) : null;
    const srvLogs = srv && isObj(srv.logs) ? (srv.logs as Json) : null;
    if (!srvLogs) {
      entries.push({ key: site.key, log: { path: null, format: "off", shared: false } });
      continue;
    }
    const loggerNames = isObj(srvLogs.logger_names) ? (srvLogs.logger_names as Json) : {};
    const skipHosts = new Set(strs(srvLogs.skip_hosts).map((h) => h.toLowerCase()));
    let picked: string | null = null;
    let shared = false;

    for (const host of site.names) {
      const low = host.toLowerCase();
      if (skipHosts.has(low)) continue;
      const mapped = loggerNames[host] ?? loggerNames[low];
      if (typeof mapped === "string" && mapped) {
        picked = mapped;
        break;
      }
      if (Array.isArray(mapped)) {
        const first = mapped.find((x): x is string => typeof x === "string" && !!x);
        if (first) {
          picked = first;
          break;
        }
      }
    }
    if (!picked && typeof srvLogs.default_logger_name === "string" && srvLogs.default_logger_name) {
      picked = srvLogs.default_logger_name;
      shared = true;
    }
    // En Caddy, si existe `srv.logs` (aunque sea `{}`), las peticiones se envían al logger por defecto
    // salvo que el host esté en `skip_hosts` o `skip_unmapped_hosts: true`.
    const allSkipped = site.names.length > 0 && site.names.every((h) => skipHosts.has(h.toLowerCase()));
    if (!picked && !allSkipped && srvLogs.skip_unmapped_hosts !== true) {
      picked = "default";
      shared = true;
    }
    if (!picked) {
      entries.push({ key: site.key, log: { path: null, format: "off", shared: false } });
      continue;
    }
    const target = caddyLoggerTarget(loggingLogs, picked);
    entries.push({ key: site.key, log: { path: target.path, format: target.format, shared } });
  }

  const marked = markSharedPaths(entries.map((e) => e.log));
  entries.forEach((e, i) => out.set(e.key, marked[i]));
  return out;
}

/** Si varios sitios escriben en la misma ruta, se marca `shared = true` para avisar y filtrar por dominio. */
function markSharedPaths(logs: SiteAccessLog[]): SiteAccessLog[] {
  const counts = new Map<string, number>();
  for (const l of logs) if (l.path) counts.set(l.path, (counts.get(l.path) ?? 0) + 1);
  return logs.map((l) => (l.path && (counts.get(l.path) ?? 0) > 1 ? { ...l, shared: true } : l));
}
