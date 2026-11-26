// Cortafuegos: piezas comunes a los lectores (reglas vacías, listas de puertos, redes, Docker/Podman).
// Funciones puras.
import type { ContainerEngine, FwRule, FwTool, PortRange } from "./types";

/** Regla con todo a «cualquiera»; el lector rellena lo que entiende. */
export function newRule(tool: FwTool, id: string, raw: string, place: string, r: Partial<FwRule> = {}): FwRule {
  return {
    id,
    tool,
    dir: "in",
    verdict: "other",
    proto: null,
    ports: [],
    service: null,
    source: null,
    iface: null,
    states: [],
    target: null,
    family: null,
    comment: null,
    extra: false,
    managedBy: null,
    place,
    raw,
    ref: null,
    ...r,
  };
}

/** «80», «80,443», «1000:2000» o «8000-8010» → rangos (null si algo no es un puerto). */
export function parsePortList(s: string): PortRange[] | null {
  const out: PortRange[] = [];
  for (const part of s.split(",")) {
    const m = /^(\d{1,5})(?:[:-](\d{1,5}))?$/.exec(part.trim());
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to > 65535 || to < from) return null;
    out.push({ from, to });
  }
  return out.length ? out : null;
}

/** «443/tcp» o «9000-9010/udp» → protocolo y rangos. */
export function parsePortProto(s: string): { proto: string; ports: PortRange[] } | null {
  const [p, proto] = s.trim().split("/");
  const ports = parsePortList(p ?? "");
  return ports && proto ? { proto: proto.toLowerCase(), ports } : null;
}

export function portsText(ports: PortRange[]): string {
  return ports.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(", ");
}

export function inRanges(port: number, ports: PortRange[]): boolean {
  return ports.some((r) => port >= r.from && port <= r.to);
}

/** Cadenas y tablas que crean los motores de contenedores (no se tocan a mano). */
export function engineOf(name: string): ContainerEngine | null {
  if (/docker/i.test(name)) return "docker";
  if (/netavark|podman|^cni[-_]|^nv_/i.test(name)) return "podman";
  return null;
}

/** «Anywhere», 0.0.0.0/0 y ::/0 = desde cualquier sitio. */
export function anySource(s: string | null | undefined): boolean {
  if (!s) return true;
  const t = s.replace(/\s*\(v6\)$/i, "").trim().toLowerCase();
  return t === "" || t === "anywhere" || t === "0.0.0.0/0" || t === "::/0" || t === "any";
}

function v4(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.flatMap((x) => {
    const n = Number(x);
    return [n >> 4, n & 15];
  });
}

function v6(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || ip.split("::").length > 2) return null;
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const missing = 8 - a.length - b.length;
  if ((tail === null && a.length !== 8) || missing < 0) return null;
  const groups = [...a, ...Array<string>(tail === null ? 0 : missing).fill("0"), ...b];
  if (groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return groups.flatMap((g) => g.padStart(4, "0").split("").map((c) => parseInt(c, 16)));
}

/** Nibbles (4 bits) de una IP para comparar prefijos. */
function nibbles(ip: string): { n: number[]; bits: number } | null {
  const a = v4(ip);
  if (a) return { n: a, bits: 32 };
  const b = v6(ip.toLowerCase());
  return b ? { n: b, bits: 128 } : null;
}

/** La IP está dentro de la red («10.0.0.0/8», «2001:db8::/32» o una IP suelta). null = no se sabe leer. */
export function ipInNet(ip: string, net: string): boolean | null {
  const [base, lenStr, ...more] = net.split("/");
  // «1.2.3.4/», «/0x8» o «/8/9» no son redes (Number("") daría 0: «cualquier sitio»).
  if (more.length || (lenStr !== undefined && !/^\d{1,3}$/.test(lenStr))) return null;
  const a = nibbles(ip);
  const b = nibbles(base ?? "");
  if (!a || !b) return null;
  if (a.bits !== b.bits) return false;
  const len = lenStr === undefined ? b.bits : Number(lenStr);
  if (!Number.isInteger(len) || len < 0 || len > b.bits) return null;
  for (let bit = 0; bit < len; bit++) {
    const i = bit >> 2;
    const mask = 8 >> (bit & 3);
    if ((a.n[i] & mask) !== (b.n[i] & mask)) return false;
  }
  return true;
}

/** IP o red válida (IPv4 o IPv6, con o sin «/prefijo»). */
export function isIpOrNet(s: string): boolean {
  return ipInNet(s.split("/")[0] ?? "", s) !== null;
}
