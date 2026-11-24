// «Servicios que puedes traer»: a partir de los puertos en escucha del servidor (Administración → Puertos)
// y de los puertos publicados de los contenedores, qué servicios hay y cómo traerlos a tu PC. Funciones puras.
import type { TunnelDef } from "../../api/tunnels";
import { scopeOf, tunnelDestHost, type ListenPort, type PortScope } from "../admin/ports";
import { splitSections } from "../../lib/remote";
import { parsePortsString } from "../containers/parse";
import { HTTPS_PORTS, PROXY_PROCESSES, SERVICE_CATALOG, type ServiceDef } from "./catalog";

/** Puerto publicado de un contenedor («127.0.0.1:5432->5432/tcp»). */
export interface ContainerPublish {
  container: string;
  /** "" = todas las interfaces. */
  hostIp: string;
  hostPort: number;
  containerPort: number;
}

/** Un servicio del servidor que se puede traer a tu PC. */
export interface FoundService {
  /** `destHost:puerto`. */
  key: string;
  port: number;
  /** Adónde va el túnel, visto desde el servidor. */
  destHost: string;
  /** local = solo se puede usar desde dentro del servidor (para eso sirve el túnel). */
  scope: PortScope;
  /** Programas que lo atienden (sin los que solo reenvían el puerto de un contenedor). */
  procs: string[];
  container: string | null;
  service: ServiceDef | null;
  /** No se reconoció, pero respondió como una web (ver probe.ts). */
  guessed?: boolean;
}

/** Lista «nombre|puertos» de los contenedores en marcha (Podman y Docker, del usuario de la conexión). */
export const CONTAINER_PORTS_SCRIPT = [
  "PATH=$PATH:/usr/local/bin:/usr/sbin:/sbin",
  "TO=''; command -v timeout >/dev/null 2>&1 && TO='timeout 5'",
  "echo @@cports",
  "for t in podman docker; do command -v $t >/dev/null 2>&1 && $TO $t ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null; done",
  "echo @@end",
].join("\n");

/** Como mucho tantos puertos de un rango publicado («8000-8010->…»). */
const MAX_RANGE = 20;

export function parseContainerPublish(stdout: string): ContainerPublish[] {
  const out: ContainerPublish[] = [];
  const seen = new Set<string>();
  for (const line of splitSections(stdout).get("cports") ?? []) {
    const i = line.indexOf("|");
    if (i <= 0) continue;
    const container = line.slice(0, i).trim();
    for (const m of parsePortsString(line.slice(i + 1))) {
      if (m.hostPort === null || m.protocol !== "tcp") continue;
      for (let k = 0; k < Math.min(m.range, MAX_RANGE); k++) {
        const hostPort = m.hostPort + k;
        const key = `${m.hostIp}|${hostPort}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ container, hostIp: m.hostIp, hostPort, containerPort: m.containerPort + k });
      }
    }
  }
  return out;
}

function score(def: ServiceDef, names: string[], ports: number[]): number {
  const byName = !!def.match && names.some((n) => def.match?.test(n));
  const byPort = ports.some((p) => def.ports.includes(p));
  if (byName) return byPort ? 3 : 2;
  if (byPort && !(def.strict && names.length > 0)) return 1;
  return 0;
}

function best(defs: ServiceDef[], names: string[], ports: number[]): ServiceDef | null {
  let top: ServiceDef | null = null;
  let topScore = 0;
  for (const d of defs) {
    const s = score(d, names, ports);
    if (s > topScore) [top, topScore] = [d, s];
  }
  return top;
}

const SPECIFIC = SERVICE_CATALOG.filter((d) => !d.generic);
const GENERIC = SERVICE_CATALOG.filter((d) => d.generic);

/**
 * Qué servicio es, por el nombre del programa o del contenedor y el puerto (el del servidor y, si es de un
 * contenedor, también el de dentro). null = no se sabe.
 */
export function identifyService(names: string[], ports: number[]): ServiceDef | null {
  return best(SPECIFIC, names, ports) ?? best(GENERIC, names, ports);
}

/** El que mejor sirve como destino del túnel: 127.0.0.1 antes que «todas» y que ::1. */
function rank(p: ListenPort): number {
  if (p.ip === "127.0.0.1") return 0;
  if (p.scope === "public") return p.family === 4 ? 1 : 2;
  if (p.scope === "local") return 3;
  return 4;
}

function groupScope(scopes: PortScope[]): PortScope {
  if (scopes.includes("public")) return "public";
  return scopes.every((s) => s === "local") ? "local" : "ip";
}

const SCOPE_ORDER: Record<PortScope, number> = { local: 0, ip: 1, public: 2 };

/**
 * Servicios TCP del servidor, juntando IPv4/IPv6 de un mismo puerto y los puertos publicados de los
 * contenedores. Sin los del propio sistema (SSH en `sshPort`, DNS…). Primero los reconocidos y los que solo
 * escuchan dentro del servidor.
 */
export function findServices(ports: ListenPort[], published: ContainerPublish[], sshPort = 22): FoundService[] {
  const byPort = new Map<number, ListenPort[]>();
  for (const p of ports) {
    if (p.proto !== "tcp") continue;
    byPort.set(p.port, [...(byPort.get(p.port) ?? []), p]);
  }
  const out: FoundService[] = [];
  const add = (port: number, destHost: string, scope: PortScope, procs: string[], container: string | null, inner: number | null) => {
    const names = [...procs, ...(container ? [container] : [])].map((n) => n.toLowerCase());
    const service = identifyService(names, inner && inner !== port ? [port, inner] : [port]);
    if (service?.hidden || port === sshPort) return;
    out.push({ key: `${destHost}:${port}`, port, destHost, scope, procs, container, service });
  };
  for (const [port, group] of byPort) {
    const rep = [...group].sort((a, b) => rank(a) - rank(b))[0];
    const pub = published.find((c) => c.hostPort === port);
    const procs = [...new Set(group.flatMap((p) => p.procs.map((x) => x.name)))].filter((n) => !PROXY_PROCESSES.test(n));
    const container = group.find((p) => p.container)?.container ?? pub?.container ?? null;
    add(port, tunnelDestHost(rep), groupScope(group.map((p) => p.scope)), procs, container, pub?.containerPort ?? null);
  }
  // Publicados sin proceso en escucha a la vista (p. ej. Docker sin docker-proxy).
  for (const c of published) {
    if (byPort.has(c.hostPort) || out.some((s) => s.port === c.hostPort)) continue;
    const ip = c.hostIp || "0.0.0.0";
    add(c.hostPort, tunnelDestHost({ ip, scope: scopeOf(ip) }), scopeOf(ip), [], c.container, c.containerPort);
  }
  return out.sort(
    (a, b) =>
      Number(!a.service) - Number(!b.service) || SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.port - b.port,
  );
}

/** Nombre para mostrar. */
export function serviceTitle(s: FoundService): string {
  if (s.guessed) return `Web en el puerto ${s.port}`;
  return s.service?.name ?? `Puerto ${s.port}`;
}

/** Cadena de conexión para copiar (bases de datos). Nunca lleva contraseña. */
export function connectionString(def: ServiceDef | null, localPort: number): string | null {
  return def?.conn ? def.conn.replace("{port}", String(localPort)) : null;
}

/** Dirección para abrir en el navegador (servicios web). */
export function browserUrl(def: ServiceDef | null, remotePort: number, localPort: number): string | null {
  if (!def?.web) return null;
  const scheme = HTTPS_PORTS.includes(remotePort) ? "https" : def.web;
  return `${scheme}://localhost:${localPort}/`;
}

function normHost(h: string): string {
  return h === "localhost" ? "127.0.0.1" : h.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Túnel local ya guardado hacia `destHost:destPort` (para no crear otro igual). */
export function findLocalTunnel(defs: TunnelDef[], destHost: string, destPort: number): TunnelDef | undefined {
  const h = normHost(destHost);
  return defs.find((d) => d.kind === "local" && d.destPort === destPort && normHost(d.destHost) === h);
}

/** Puerto que se propone en tu PC: el mismo; los menores de 1024 necesitan permisos de administrador. */
export function wantedLocalPort(remotePort: number): number {
  return remotePort < 1024 ? remotePort + 8000 : remotePort;
}
