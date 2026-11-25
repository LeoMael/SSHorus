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

/** Una salida del registro de un sitio (un sitio puede escribir en varias a la vez). */
interface LogTarget {
  path: string | null;
  format: AccessLogFormat;
  /** Viene del nivel de arriba (el `http {}` de nginx o el logger por defecto de Caddy). */
  inherited: boolean;
}

const OFF: LogTarget = { path: null, format: "off", inherited: false };
const DEFAULT_NGINX_ACCESS_LOG = "/var/log/nginx/access.log";

/**
 * Elige el registro de cada sitio entre sus salidas: el archivo que solo usa ese sitio (el que se le
 * puso a propósito, p. ej. el de SSHorus junto a uno común) o, si no hay, el último archivo; y marca
 * `shared` si lo heredó o si otros sitios escriben en el mismo archivo.
 */
function pickLogs(targets: LogTarget[][]): SiteAccessLog[] {
  const users = new Map<string, number>();
  for (const list of targets) {
    for (const p of new Set(list.map((t) => t.path).filter((p): p is string => !!p))) users.set(p, (users.get(p) ?? 0) + 1);
  }
  return targets.map((list) => {
    const files = list.filter((t) => t.path);
    const pick = files.find((t) => users.get(t.path ?? "") === 1) ?? files[files.length - 1] ?? list[0] ?? OFF;
    const shared = pick.inherited || (!!pick.path && (users.get(pick.path) ?? 0) > 1);
    return { path: pick.path, format: pick.format, shared };
  });
}

/** Las directivas `access_log` directas de un bloque nginx (`http` o `server`); null si no tiene. */
function nginxTargets(dirs: NgxDirective[], inherited: boolean): LogTarget[] | null {
  const hits = dirs.filter((d) => d.name === "access_log" && !d.block && d.args.length > 0);
  if (hits.length === 0) return null;
  // «access_log off» anula todas las del mismo nivel.
  if (hits.some((d) => d.args[0] === "off")) return [OFF];
  // syslog:… o rutas con variables ($host) no se leen como archivo plano.
  const files = hits.map((d) => d.args[0]).filter((p) => !p.startsWith("syslog:") && !p.includes("$"));
  return files.length ? files.map((path) => ({ path, format: "combined", inherited })) : [OFF];
}

/** Detecta el access_log de cada bloque `server {}` de nginx (heredando de `http {}` y marcando compartidos). */
export function detectNginxAccessLogs(http: NgxDirective[], serverBlocks: NgxDirective[][]): SiteAccessLog[] {
  const fromHttp = nginxTargets(http, true) ?? [{ path: DEFAULT_NGINX_ACCESS_LOG, format: "combined", inherited: true }];
  return pickLogs(serverBlocks.map((b) => nginxTargets(b, false) ?? fromHttp));
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** Caddy 2.6 guarda los hosts con puerto («a.test:8081») cuando el sitio no usa el puerto habitual. */
const bareHost = (h: string) => h.toLowerCase().replace(/:\d+$/, "");

/** A qué archivo o destino escribe un logger de Caddy (`cfg.logging.logs[name]`). */
function caddyLoggerTarget(loggingLogs: Json, loggerName: string, inherited: boolean): LogTarget {
  const entry = isObj(loggingLogs[loggerName]) ? loggingLogs[loggerName] : null;
  const writer = entry && isObj(entry.writer) ? entry.writer : null;
  if (writer?.output === "file" && typeof writer.filename === "string" && writer.filename.trim()) {
    return { path: writer.filename.trim(), format: "json", inherited };
  }
  if (writer?.output === "discard") return OFF;
  // Sin writer=file (stdout/stderr por defecto): queda en el journal de systemd (`journalctl -u caddy`).
  return { path: null, format: "journal", inherited };
}

/** Loggers de cada host de `srv.logs.logger_names` (texto o lista; «» es el logger por defecto). */
function loggerNames(srvLogs: Json): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const raw = isObj(srvLogs.logger_names) ? srvLogs.logger_names : {};
  for (const [host, v] of Object.entries(raw)) {
    const names = typeof v === "string" ? [v] : strs(v);
    out.set(bareHost(host), names.map((n) => n || "default"));
  }
  return out;
}

/** Salidas del registro de un sitio de Caddy en un servidor con `logs`. */
function caddyTargets(site: Site, srvLogs: Json, loggingLogs: Json): LogTarget[] {
  const mapped = loggerNames(srvLogs);
  const skip = new Set(strs(srvLogs.skip_hosts).map(bareHost));
  const hosts = site.names.map(bareHost).filter((h) => !skip.has(h));
  const own = hosts.flatMap((h) => mapped.get(h) ?? []);
  if (own.length) return [...new Set(own)].map((n) => caddyLoggerTarget(loggingLogs, n, false));
  // Con `logs` (aunque sea `{}`), lo que no tiene logger propio va al de por defecto, salvo los
  // hosts de `skip_hosts` o si `skip_unmapped_hosts` es true.
  const allSkipped = site.names.length > 0 && hosts.length === 0;
  if (allSkipped || srvLogs.skip_unmapped_hosts === true) return [OFF];
  const fallback = typeof srvLogs.default_logger_name === "string" && srvLogs.default_logger_name ? srvLogs.default_logger_name : "default";
  return [caddyLoggerTarget(loggingLogs, fallback, true)];
}

/** Detecta el log de acceso de cada sitio de Caddy a partir del JSON completo (`cfg`). */
export function detectCaddyAccessLogs(cfg: unknown, sites: Site[]): Map<string, SiteAccessLog> {
  const servers = isObj(cfg) && isObj(cfg.apps) && isObj(cfg.apps.http) && isObj(cfg.apps.http.servers) ? cfg.apps.http.servers : {};
  const loggingLogs = isObj(cfg) && isObj(cfg.logging) && isObj(cfg.logging.logs) ? cfg.logging.logs : {};
  const targets = sites.map((site) => {
    const srv = servers[site.key.split("|")[1] ?? ""];
    const srvLogs = isObj(srv) && isObj(srv.logs) ? srv.logs : null;
    return srvLogs ? caddyTargets(site, srvLogs, loggingLogs) : [OFF];
  });
  const picked = pickLogs(targets);
  return new Map(sites.map((s, i) => [s.key, picked[i]]));
}
