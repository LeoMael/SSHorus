// Tipos, script POSIX sh de solo lectura y helpers de clasificación para «Qué pueden ver tus usuarios».
import type { PortsResult } from "./ports";

export type VisibilityStatus = "ok" | "warn" | "bad" | "skip";

export type VisibilityArea = "tunnels" | "localServices" | "processes" | "files" | "cronLogs" | "containers";

export interface VisibilityCheck {
  area: VisibilityArea;
  title: string;
  status: VisibilityStatus;
  /** Etiqueta breve para la tabla: «No puede ver», «Puede ver», «Aviso» o «Sin comprobar». */
  verdict: string;
  /** Explicación en lenguaje simple (sin nombres propios ni rutas para poder reutilizarla). */
  detail: string;
  /** Elementos concretos afectados (puertos, rutas, grupos…). */
  items: string[];
  /** Si se puede arreglar con un plan automático (clave para `userVisibilityPlans.ts`). */
  fixable: boolean;
  /** Consejo manual si no tiene arreglo automático. */
  manualHint?: string;
}

export interface UserVisibilityReport {
  user: string;
  uid: number;
  home: string;
  shell: string;
  groups: string[];
  score: number | null;
  grade: string | null;
  exposedCount: number;
  warnCount: number;
  okCount: number;
  checks: VisibilityCheck[];
  /** Datos auxiliares para construir los planes de arreglo del usuario. */
  exposedHomes: string[];
  logGroups: string[];
  inDockerGroup: boolean;
}

export interface LocalServiceInfo {
  port: number;
  ip: string;
  name: string;
  likelyNoAuth: boolean;
  label: string;
}

export interface VisibilityReport {
  elevated: boolean;
  adminUsers: string[];
  adminGroups: string[];
  sshIncludeD: boolean;
  hidepid: boolean | null;
  webDirs: string[];
  webFiles: string[];
  hasCaddyGroup: boolean;
  worldLogs: string[];
  worldCron: string[];
  dockerSock: { path: string; mode: number; group: string; worldOpen: boolean } | null;
  openRuntimeDirs: string[];
  exposedHomesAll: string[];
  localServices: LocalServiceInfo[];
  users: UserVisibilityReport[];
  score: number | null;
  grade: string | null;
  summary: string;
}

export interface SshTunnelCaps {
  tcp: string;
  stream: string;
  x11: string;
  tunnel: string;
  gateway: string;
}

export const NO_LOGIN_SHELL = /(^|\/)(nologin|false|sync|halt|shutdown)$/;

/** Script POSIX sh ligero de solo lectura para evaluar qué ve cada usuario sin sudo. */
export const USER_VISIBILITY_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin; export PATH",
  "LC_ALL=C; export LC_ALL",
  "ME=$(id -u)",
  'echo @@id; echo "$ME $(id -un)"',
  "echo @@passwd; cut -d: -f1,3,4,6,7 /etc/passwd 2>/dev/null",
  "echo @@groups; cat /etc/group 2>/dev/null",
  "echo @@sudoers",
  "if [ -r /etc/sudoers ]; then cat /etc/sudoers /etc/sudoers.d/* 2>/dev/null | grep -vE '^[[:space:]]*(#|$)'; elif [ -e /etc/sudoers ]; then echo @noread; fi",
  "if [ -r /etc/doas.conf ]; then sed 's/^/doas: /' /etc/doas.conf | grep -v '^doas: *#'; elif [ -e /etc/doas.conf ]; then echo @noread; fi",
  "echo @@sshinc; grep -ciE '^[[:space:]]*include[[:space:]]+/etc/ssh/sshd_config\\.d' /etc/ssh/sshd_config 2>/dev/null; true",
  "echo @@sshtun",
  "if ! command -v sshd >/dev/null 2>&1; then echo @nosshd",
  "else",
  "  _probe=$(sshd -T 2>/dev/null | head -n1)",
  "  if [ -z \"$_probe\" ]; then echo @noread",
  "  else",
  "    cut -d: -f1,3,7 /etc/passwd 2>/dev/null | while IFS=: read -r u uid shl; do",
  '      { [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ]; } 2>/dev/null || continue',
  '      case "$shl" in *nologin|*false|*sync|*halt|*shutdown) continue;; esac',
  '      o=$(sshd -T -C "user=$u,host=localhost,addr=127.0.0.1" 2>/dev/null)',
  '      [ -n "$o" ] || continue',
  "      tcp=$(printf '%s\\n' \"$o\" | awk '$1==\"allowtcpforwarding\"{print $2; exit}')",
  "      str=$(printf '%s\\n' \"$o\" | awk '$1==\"allowstreamlocalforwarding\"{print $2; exit}')",
  "      x11=$(printf '%s\\n' \"$o\" | awk '$1==\"x11forwarding\"{print $2; exit}')",
  "      tun=$(printf '%s\\n' \"$o\" | awk '$1==\"permittunnel\"{print $2; exit}')",
  "      gw=$(printf '%s\\n' \"$o\" | awk '$1==\"gatewayports\"{print $2; exit}')",
  '      echo "$u|$tcp|$str|$x11|$tun|$gw"',
  "    done",
  "  fi",
  "fi",
  "echo @@proc; grep -E '^[^ ]+ /proc proc ' /proc/mounts 2>/dev/null",
  "echo @@homes",
  "cut -d: -f1,3,6,7 /etc/passwd 2>/dev/null | while IFS=: read -r u uid h shl; do",
  '  { [ "$uid" -ge 1000 ] && [ "$uid" -lt 65534 ]; } 2>/dev/null || continue',
  '  [ -d "$h" ] && stat -c "$u|%n|%a|%U|%G" "$h" 2>/dev/null',
  "done",
  "echo @@webperm",
  'for d in /etc/nginx /etc/caddy /etc/apache2 /etc/httpd; do [ -d "$d" ] && { echo "@dir $d"; find "$d" -xdev -type f -perm -0004 2>/dev/null | head -n 40; }; done',
  "getent group caddy >/dev/null 2>&1 && echo '@group caddy'",
  "echo @@cronlogs",
  'for f in /etc/crontab /etc/cron.d/*; do [ -f "$f" ] && [ -n "$(find "$f" -maxdepth 0 -perm -0004 2>/dev/null)" ] && echo "@cron $f"; done',
  'for f in /var/log/auth.log /var/log/secure /var/log/syslog /var/log/messages /var/log/nginx/*.log /var/log/caddy/*.log; do [ -f "$f" ] && [ -n "$(find "$f" -maxdepth 0 -perm -0004 2>/dev/null)" ] && echo "@log $f"; done',
  "echo @@dockersock",
  'for s in /var/run/docker.sock /run/docker.sock; do [ -S "$s" ] && { stat -c "@sock %n|%a|%U|%G" "$s" 2>/dev/null; break; }; done',
  'for d in /tmp/sshorus-run-* /run/user/*; do [ -d "$d" ] && stat -c "@run %n|%a|%U|%G" "$d" 2>/dev/null; done',
  "echo @@end",
].join("\n");

// Servicios internos que a menudo arrancan en 127.0.0.1 sin contraseña por defecto.
const LIKELY_NO_AUTH_PORTS = new Set([6379, 11211, 27017, 9200, 9300, 11434, 9090, 8086, 5984, 8123, 2379, 8500]);
const LIKELY_NO_AUTH_PROCS = /^(redis-server|valkey-server|memcached|mongod|ollama|prometheus|etcd|consul|clickhouse)/i;

/** Clasifica los puertos TCP en 127.0.0.1 / ::1 a los que puede llegar cualquier shell local. */
export function classifyLocalServices(ports: PortsResult | null): LocalServiceInfo[] {
  if (!ports) return [];
  const seen = new Set<string>();
  const out: LocalServiceInfo[] = [];
  for (const p of ports.ports) {
    if (p.proto !== "tcp" || p.scope !== "local") continue;
    const key = `${p.ip}:${p.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const proc = p.container ? `contenedor ${p.container}` : p.unit ?? p.procs[0]?.name ?? "servicio local";
    const rawName = p.procs[0]?.name ?? p.unit ?? "";
    const likelyNoAuth = LIKELY_NO_AUTH_PORTS.has(p.port) || LIKELY_NO_AUTH_PROCS.test(rawName);
    const host = p.ip.includes(":") ? `[${p.ip}]` : p.ip;
    out.push({
      port: p.port,
      ip: p.ip,
      name: proc,
      likelyNoAuth,
      label: `${host}:${p.port} · ${proc}${likelyNoAuth ? " (suele ir sin contraseña)" : ""}`,
    });
  }
  return out.sort((a, b) => Number(b.likelyNoAuth) - Number(a.likelyNoAuth) || a.port - b.port);
}

/** Parsea `@@sshtun` → mapa usuario → opciones efectivas de túneles de sshd. */
export function parseSshTunnels(ls: string[]): { state: "ok" | "noread" | "nosshd"; map: Map<string, SshTunnelCaps> } {
  if (ls.includes("@nosshd")) return { state: "nosshd", map: new Map() };
  if (ls.includes("@noread")) return { state: "noread", map: new Map() };
  const map = new Map<string, SshTunnelCaps>();
  for (const l of ls) {
    const [u, tcp = "", stream = "", x11 = "", tunnel = "", gateway = ""] = l.split("|");
    if (!u || u.startsWith("@")) continue;
    map.set(u, {
      tcp: tcp.toLowerCase(),
      stream: stream.toLowerCase(),
      x11: x11.toLowerCase(),
      tunnel: tunnel.toLowerCase(),
      gateway: gateway.toLowerCase(),
    });
  }
  return { state: "ok", map };
}

/** Qué directivas de túnel siguen activas para un usuario según `sshd -T -C`. */
export function openTunnelFlags(c: SshTunnelCaps): string[] {
  const open: string[] = [];
  if (c.tcp && c.tcp !== "no") open.push(`AllowTcpForwarding ${c.tcp}`);
  if (c.stream && c.stream !== "no") open.push(`AllowStreamLocalForwarding ${c.stream}`);
  if (c.x11 && c.x11 !== "no") open.push(`X11Forwarding ${c.x11}`);
  if (c.tunnel && c.tunnel !== "no") open.push(`PermitTunnel ${c.tunnel}`);
  if (c.gateway && c.gateway !== "no") open.push(`GatewayPorts ${c.gateway}`);
  return open;
}
