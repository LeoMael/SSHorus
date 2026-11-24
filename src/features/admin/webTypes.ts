// Tipos compartidos de Sitios web (nginx y Caddy) y utilidades de puertos/URLs/certificados.
import type { SiteAccessLog } from "./webTrafficLog";

export type WebServer = "nginx" | "caddy";

/** A qué sirve una ruta del sitio. */
export type Target =
  | { kind: "proxy"; url: string; host: string | null; port: number | null; socket: string | null }
  | { kind: "files"; root: string }
  | { kind: "redirect"; to: string; code: number | null }
  | { kind: "fastcgi"; addr: string; host: string | null; port: number | null }
  | { kind: "other"; text: string };

export interface SiteRoute {
  /** «/», «/api/», «~ \.php$»… */
  path: string;
  target: Target;
}

export interface Listen {
  /** null = todas las interfaces. */
  host: string | null;
  port: number;
  https: boolean;
}

export interface Site {
  key: string;
  server: WebServer;
  /** Dominios (vacío = cualquiera / sitio por defecto). */
  names: string[];
  listens: Listen[];
  https: boolean;
  isDefault: boolean;
  /** Ruta del certificado (nginx). */
  cert: string | null;
  /** Caducidad del certificado (ms desde 1970) si se pudo leer. */
  certExpires: number | null;
  routes: SiteRoute[];
  /** Archivo y línea donde se define. */
  file: string | null;
  line: number | null;
  /** Registro de visitas (access log) detectado en la configuración. */
  accessLog?: SiteAccessLog | null;
}

export interface ServerInfo {
  server: WebServer;
  /** De dónde salió la configuración. */
  source: "dump" | "files" | "api" | "adapt";
  /** Archivo principal (nginx.conf o Caddyfile). */
  configPath: string;
  /** Estado del servicio systemd (active, inactive, failed…) o null si no hay systemd o no existe la unidad. */
  status: string | null;
  sites: Site[];
  /** Problemas al leer la configuración. */
  warning: string | null;
}

export interface WebResult {
  servers: ServerInfo[];
}

function defaultPort(scheme: string): number | null {
  if (scheme === "http") return 80;
  if (scheme === "https") return 443;
  return null;
}

/** «http://127.0.0.1:3000/api» → host/puerto (o socket unix). */
export function parseUpstreamUrl(url: string): { host: string | null; port: number | null; socket: string | null } {
  const m = /^(?:(https?|grpcs?|uwsgi|fastcgi):\/\/)?(.*)$/i.exec(url.trim());
  const scheme = (m?.[1] ?? "").toLowerCase();
  let rest = m?.[2] ?? url;
  if (rest.startsWith("unix:")) {
    const sock = rest.slice(5).replace(/:.*$/, "");
    return { host: null, port: null, socket: sock || null };
  }
  rest = rest.replace(/[/?#].*$/, "");
  if (!rest || rest.includes("$")) return { host: null, port: null, socket: null };
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : defaultPort(scheme), socket: null };
  const i = rest.lastIndexOf(":");
  if (i > 0 && /^\d+$/.test(rest.slice(i + 1))) return { host: rest.slice(0, i), port: Number(rest.slice(i + 1)), socket: null };
  return { host: rest, port: defaultPort(scheme), socket: null };
}

/** Puertos de un sitio para mostrar, sin repetidos: `listen 443 ssl` + `listen [::]:443 ssl` → un solo «443 HTTPS». */
export function uniqueListens(listens: Listen[]): Listen[] {
  const seen = new Set<string>();
  return listens.filter((l) => {
    const k = `${l.host ?? ""}|${l.port}|${l.https}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** «Mar  5 12:00:00 2027 GMT» (openssl -enddate) → ms. */
export function parseOpensslDate(s: string): number | null {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1]);
  if (mon < 0) return null;
  return Date.UTC(Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

export function parseCerts(lines: string[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const l of lines) {
    const i = l.lastIndexOf("|");
    if (i <= 0) continue;
    out.set(l.slice(0, i), parseOpensslDate(l.slice(i + 1)));
  }
  return out;
}

/** Texto de los días que faltan para que caduque un certificado. */
export function certStatus(expires: number | null, now = Date.now()): { text: string; level: "ok" | "warn" | "bad" } | null {
  if (expires === null) return null;
  const days = Math.floor((expires - now) / 86_400_000);
  if (days < 0) return { text: `caducó hace ${-days} ${-days === 1 ? "día" : "días"}`, level: "bad" };
  if (days === 0) return { text: "caduca hoy", level: "bad" };
  return { text: `caduca en ${days} ${days === 1 ? "día" : "días"}`, level: days < 14 ? "bad" : days < 30 ? "warn" : "ok" };
}
