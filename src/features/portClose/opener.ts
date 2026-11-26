// «Cerrar puerto»: quién tiene abierto el puerto (SSH, un contenedor, un servicio de systemd o un programa
// suelto), con lo leído en Puertos y en Contenedores. Funciones puras.
import type { ListenPort } from "../admin/ports";
import type { FoundContainer } from "../containers/readAll";
import type { Engine } from "../containers/types";
import { containerFor, PLUMBING_RE } from "../infra/graphTypes";
import type { PortOpener } from "./types";

const SSH_UNIT = /^sshd?(@.*)?\.(service|socket)$/;

/** Programas que publican puertos de contenedores en el servidor, y de qué motor son. */
const PUBLISHERS: { re: RegExp; engine: Engine | null; rootless: boolean | null }[] = [
  { re: /^docker-proxy$/, engine: "docker", rootless: false },
  { re: /^(rootlessport|pasta(\.avx2)?|slirp4netns)$/, engine: "podman", rootless: true },
  // Docker sin root lo usa siempre; Podman sin root, solo en versiones viejas.
  { re: /^rootlesskit$/, engine: null, rootless: true },
  { re: /^conmon$/, engine: "podman", rootless: null },
];

function publisher(p: ListenPort): { engine: Engine | null; rootless: boolean | null } | null {
  for (const x of p.procs) {
    const hit = PUBLISHERS.find((k) => k.re.test(x.name));
    if (hit) return { engine: hit.engine, rootless: hit.rootless ?? (p.user ? p.user !== "root" : null) };
  }
  return null;
}

/** Es el servidor SSH (por el puerto de esta conexión o porque lo escucha sshd). */
export function isSshPort(p: ListenPort, sshPorts: number[]): boolean {
  if (p.proto === "tcp" && sshPorts.includes(p.port)) return true;
  return p.procs.some((x) => /^sshd\b/.test(x.name)) || SSH_UNIT.test(p.unit ?? "");
}

/** Quién abre el puerto. `containers`: los leídos de todos los dueños (los de otros usuarios, con sudo). */
export function findOpener(p: ListenPort, containers: FoundContainer[], sshPorts: number[]): PortOpener {
  if (isSshPort(p, sshPorts)) return { kind: "ssh" };
  const proc = p.procs[0]?.name ?? null;
  const pub = publisher(p);
  const hit = containerFor(p, containers);
  const ctr = hit ? (containers.find((c) => c.id === hit.id) ?? null) : null;
  if (ctr && (!proc || p.container || pub || PLUMBING_RE.test(proc))) {
    return { kind: "container", name: ctr.name, engine: ctr.engine, rootless: ctr.user !== "root", ctr };
  }
  if (p.container || pub) return { kind: "container", name: p.container, engine: pub?.engine ?? null, rootless: pub?.rootless ?? null, ctr: null };
  if (p.unit) return { kind: "service", unit: p.unit, userUnit: !!p.userUnit, user: p.user };
  if (p.procs.length) return { kind: "process", procs: p.procs, user: p.user };
  return { kind: "unknown" };
}

/** El puerto (expuesto) que representa un nodo «puerto» del mapa (`<servidor>|port:tcp:80`). */
export function portOfMapNode(nodeId: string, ports: ListenPort[]): ListenPort | null {
  const m = /\|port:(tcp|udp):(\d+)$/.exec(nodeId);
  if (!m) return null;
  const port = Number(m[2]);
  return ports.find((p) => p.proto === m[1] && p.port === port && p.scope !== "local") ?? null;
}
