// Tipos y funciones auxiliares puras del grafo de infraestructura.
import type { ListenPort, PortsResult } from "../admin";
import { certStatus, type Site, type WebResult } from "../admin/webTypes";
import type { OwnedContainer, Container } from "../containers";
import { sortOwners, type OwnerContext } from "./owner";
import type { InfraExtra } from "./parse";

export { SYSTEM_OWNER, UNKNOWN_OWNER, sortOwners } from "./owner";

export type { OwnedContainer };

export interface ServerSnapshot {
  id: string;
  name: string;
  host: string;
  sessionId: string | null;
  error: string | null;
  offline?: boolean;
  elevated: boolean;
  me: string | null;
  ports: PortsResult | null;
  web: WebResult | null;
  containers: OwnedContainer[];
  extra: InfraExtra | null;
  userServices: Record<string, string[]>;
  configOwners?: Record<string, string>;
  canSudo?: boolean;
  notes: string[];
}

export type NodeKind =
  | "internet"
  | "firewall"
  | "port"
  | "proxy"
  | "site"
  | "container"
  | "service"
  | "process"
  | "db"
  | "system"
  | "external";

export type Health = "ok" | "warn" | "bad" | "off";

export type NavTarget =
  | { kind: "ports"; port: number }
  | { kind: "web" }
  | { kind: "containers"; name: string };

export interface MapNode {
  id: string;
  server: string | null;
  owner: string | null;
  kind: NodeKind;
  layer: number;
  label: string;
  sub: string;
  health: Health;
  group: string | null;
  localOnly: boolean;
  details: [string, string][];
  nav: NavTarget | null;
}

export type EdgeKind = "net" | "proxy" | "publish" | "cross";

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
}

export interface MapServer {
  id: string;
  name: string;
  os: string | null;
  host: string;
  health: Health;
  owners: string[];
  elevated: boolean;
  notes: string[];
  firewall: string | null;
  hidden?: number;
}

export interface InfraGraph {
  servers: MapServer[];
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface GraphFilter {
  hideLocal: boolean;
  hideSystem: boolean;
  owners: Set<string> | null;
}

export interface Listener {
  node: MapNode;
  pids: Set<number>;
  procName: string | null;
  ports: ListenPort[];
}

export interface PendingUpstream {
  sid: string;
  from: string;
  host: string | null;
  port: number | null;
  socket: string | null;
  label: string;
  owner: string;
  url: string;
}

export const LAYERS = ["Internet", "Cortafuegos", "Entrada", "Proxy", "Sitios", "Apps", "Datos"];

export const DB_RE = /postgres|mysqld|mariadb|mongod|mongo|redis|valkey|memcached|elasticsearch|opensearch|clickhouse|rabbitmq|beam\.smp|influxd|cassandra|cockroach|etcd|keydb|minio/i;
export const PROXY_RE = /^(nginx|caddy|apache2?|httpd|traefik|haproxy|envoy|lighttpd)$/i;
export const PROXY_IMG_RE = /(^|\/)(nginx|caddy|traefik|haproxy|httpd|envoy)(:|$|-)/i;
export const SYSTEM_RE =
  /^(sshd|systemd.*|chronyd|ntpd|cupsd|cups-browsed|rpcbind|rpc\.\w+|avahi-daemon|dnsmasq|master|exim4?|postfix|dhclient|NetworkManager|containerd|dockerd|cockpit.*|smbd|nmbd|rsyslogd|sssd|zabbix_agentd|node_exporter|tailscaled|xrdp.*|colord|snapd)$/;
export const PLUMBING_RE = /^(rootlessport|rootlesskit|docker-proxy|conmon|pasta|pasta\.avx2|slirp4netns|podman)$/;
const DB_PORTS = new Set([5432, 3306, 6379, 27017, 11211, 9200, 5672, 9042, 26257, 8086, 6380, 2379, 9000]);

export function isLocalHost(h: string | null): boolean {
  if (!h) return true;
  const x = h.toLowerCase().replace(/^\[|\]$/g, "");
  return x === "localhost" || x.startsWith("127.") || x === "::1" || x === "0.0.0.0" || x === "::" || x === "*";
}

export function healthOfContainer(c: Container): Health {
  if (c.state === "running") return c.health === "unhealthy" ? "bad" : c.health === "starting" ? "warn" : "ok";
  if (c.state === "restarting" || c.state === "paused") return "warn";
  if (c.state === "exited" && c.exitCode !== null && c.exitCode !== 0) return "bad";
  return "off";
}

export function portText(p: { port: number; proto: string }): string {
  return p.proto === "udp" ? `${p.port}/udp` : `:${p.port}`;
}

export function containerFor(p: ListenPort, cs: OwnedContainer[]): OwnedContainer | null {
  if (p.container) {
    const k = p.container;
    const byName = cs.find((c) => c.name === k || c.id.startsWith(k) || k.startsWith(c.shortId));
    if (byName) return byName;
  }
  const pub = cs.filter((c) => c.state === "running" && c.ports.some((m) => m.hostPort !== null && p.port >= m.hostPort && p.port < m.hostPort + Math.max(1, m.range) && m.protocol === p.proto));
  if (pub.length === 0) return null;
  return pub.find((c) => c.user === p.user) ?? pub[0];
}

export function classify(name: string, port: number | null): NodeKind {
  if (PROXY_RE.test(name)) return "proxy";
  if (DB_RE.test(name)) return "db";
  if (SYSTEM_RE.test(name) || /^systemd-/.test(name)) return "system";
  if (port !== null && DB_PORTS.has(port) && !name) return "db";
  return "process";
}

function routeText(t: Site["routes"][number]["target"]): string {
  switch (t.kind) {
    case "proxy":
      return `→ ${t.url}`;
    case "fastcgi":
      return `fastcgi ${t.addr}`;
    case "files":
      return `archivos ${t.root}`;
    case "redirect":
      return `redirige ${t.to}`;
    default:
      return t.text;
  }
}

export function siteNode(site: Site, sid: string, owner: string, now: number): MapNode {
  const cert = site.https ? certStatus(site.certExpires, now) : null;
  const name = site.names[0] ?? (site.isDefault ? "(por defecto)" : "(sin nombre)");
  const more = site.names.length > 1 ? ` +${site.names.length - 1}` : "";
  return {
    id: `${sid}|site:${site.key}`,
    server: sid,
    owner,
    kind: "site",
    layer: 4,
    label: name + more,
    sub: site.https ? (cert ? `TLS · ${cert.text.replace(/^caduca en /, "")}` : "TLS") : "HTTP",
    health: cert ? cert.level : "ok",
    group: null,
    localOnly: false,
    details: [
      ["Dominios", site.names.join(", ") || "cualquiera"],
      ["Escucha", site.listens.map((l) => `${l.port}${l.https ? " HTTPS" : ""}`).join(", ")],
      ...(site.https ? [["Certificado", cert?.text ?? "sin leer"] as [string, string]] : []),
      ...site.routes.map((r) => [r.path, routeText(r.target)] as [string, string]),
      ...(site.file ? [["Archivo", `${site.file}${site.line ? `:${site.line}` : ""}`] as [string, string]] : []),
    ],
    nav: { kind: "web" },
  };
}

export function ownerContext(s: ServerSnapshot): OwnerContext {
  return { me: s.me, seesAll: s.elevated, humans: s.extra?.humans ?? null };
}

/** Aplica los filtros: quita nodos y las aristas que se quedan sin uno de sus extremos. */
export function filterGraph(g: InfraGraph, f: GraphFilter): InfraGraph {
  const linked = new Set<string>();
  for (const e of g.edges) {
    if (e.kind !== "net") {
      linked.add(e.from);
      linked.add(e.to);
    }
  }
  let keep = g.nodes.filter((n) => {
    if (n.kind === "internet") return true;
    if (f.owners && n.owner && !f.owners.has(n.owner)) return false;
    if (f.hideSystem && n.kind === "system") return false;
    if (f.hideLocal && n.localOnly && !linked.has(n.id) && n.kind !== "proxy") return false;
    return true;
  });
  let ids = new Set(keep.map((n) => n.id));
  let edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const outgoing = new Set(edges.map((e) => e.from));
  keep = keep.filter((n) => (n.kind !== "port" && n.kind !== "firewall") || outgoing.has(n.id));
  ids = new Set(keep.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const used = new Set(edges.map((e) => e.from));
  if (!used.has("internet")) keep = keep.filter((n) => n.kind !== "internet");
  const servers = g.servers.map((s) => ({ ...s, owners: f.owners ? s.owners.filter((o) => f.owners!.has(o)) : s.owners }));
  return { servers, nodes: keep, edges };
}

/** Todos los usuarios que aparecen en el grafo. */
export function graphOwners(g: InfraGraph): string[] {
  return sortOwners(g.servers.flatMap((s) => s.owners), null);
}
