// Cortafuegos: lectura de ufw (`ufw status verbose` o `numbered`, y `ufw show added`). Funciones puras.
import { anySource, newRule, parsePortList } from "./common";
import type { FwDir, FwRule, FwVerdict, PortRange, UfwDefaults } from "./types";

/** Perfiles de aplicación habituales de ufw (`ufw app info`), para saber qué puertos abren. */
export const UFW_APPS: Record<string, { proto: string; ports: PortRange[] }> = {
  OpenSSH: { proto: "tcp", ports: [{ from: 22, to: 22 }] },
  "Nginx HTTP": { proto: "tcp", ports: [{ from: 80, to: 80 }] },
  "Nginx HTTPS": { proto: "tcp", ports: [{ from: 443, to: 443 }] },
  "Nginx Full": { proto: "tcp", ports: [{ from: 80, to: 80 }, { from: 443, to: 443 }] },
  Apache: { proto: "tcp", ports: [{ from: 80, to: 80 }] },
  "Apache Secure": { proto: "tcp", ports: [{ from: 443, to: 443 }] },
  "Apache Full": { proto: "tcp", ports: [{ from: 80, to: 80 }, { from: 443, to: 443 }] },
  Postfix: { proto: "tcp", ports: [{ from: 25, to: 25 }] },
};

const VERDICTS: Record<string, FwVerdict> = { ALLOW: "allow", DENY: "deny", REJECT: "reject", LIMIT: "limit" };
const DIRS: Record<string, FwDir> = { IN: "in", OUT: "out", FWD: "forward" };

export interface UfwStatus {
  active: boolean | null;
  defaults: UfwDefaults | null;
  rules: FwRule[];
}

/** «deny (incoming), allow (outgoing), disabled (routed)». */
export function parseUfwDefaults(text: string): UfwDefaults | null {
  const pick = (k: string) => new RegExp(`(\\w+)\\s+\\(${k}\\)`).exec(text)?.[1] ?? "";
  const d = { incoming: pick("incoming"), outgoing: pick("outgoing"), routed: pick("routed") };
  return d.incoming ? d : null;
}

/** Puerto(s) y protocolo («22/tcp», «80,443/tcp», «8000:8010/udp», «53»). */
function portSpec(s: string): { ports: PortRange[]; proto: string | null } | null {
  const m = /^([\d,:]+)(?:\/(tcp|udp))?$/.exec(s);
  const ports = m ? parsePortList(m[1]) : null;
  return ports ? { ports, proto: m?.[2] ?? null } : null;
}

/** Los argumentos de `ufw` que crean esta regla (null si SSHorus no sabe escribirla). */
export function ufwSpec(r: FwRule): string[] | null {
  const verb = { allow: "allow", deny: "deny", reject: "reject", limit: "limit" }[r.verdict as string];
  if (!verb || r.extra || r.iface || (r.dir !== "in" && r.dir !== "out")) return null;
  const head = r.dir === "out" ? [verb, "out"] : [verb];
  const ports = r.ports.map((p) => (p.from === p.to ? `${p.from}` : `${p.from}:${p.to}`)).join(",");
  if (!r.source) {
    if (r.service) return [...head, r.service];
    if (!ports) return null;
    return [...head, r.proto ? `${ports}/${r.proto}` : ports];
  }
  const from = [...head, "from", r.source];
  if (r.service) return [...from, "to", "any", "app", r.service];
  if (!ports) return from;
  return [...from, "to", "any", "port", ports, ...(r.proto ? ["proto", r.proto] : [])];
}

/** Una línea de reglas: «[ 2] 80,443/tcp   ALLOW IN   10.0.0.0/8   # web». */
export function parseUfwRule(line: string, id: string): FwRule | null {
  const body = line.replace(/^\[\s*\d+\]\s*/, "").trimEnd();
  const cols = body.split(/\s{2,}/);
  if (cols.length < 3) return null;
  const [toCol, actCol, ...rest] = cols;
  const act = /^(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?$/.exec(actCol);
  if (!act) return null;
  let fromCol = rest.join("  ");
  let comment: string | null = null;
  const c = /\s*#\s?(.*)$/.exec(fromCol);
  if (c) {
    comment = c[1] || null;
    fromCol = fromCol.slice(0, c.index);
  }
  let to = toCol.trim();
  const v6 = /\(v6\)/.test(to) || /\(v6\)/.test(fromCol);
  to = to.replace(/\s*\(v6\)/, "");
  let iface: string | null = null;
  const on = /^(.*?)\s+on\s+(\S+)$/.exec(to);
  if (on) {
    to = on[1];
    iface = on[2];
  }
  const r = newRule("ufw", id, line.trim(), "ufw", {
    verdict: VERDICTS[act[1]],
    dir: DIRS[act[2] ?? "IN"],
    iface,
    comment,
    family: v6 ? "ipv6" : null,
  });
  const from = fromCol.replace(/\s*\(v6\)/, "").trim();
  if (!anySource(from)) {
    const [addr, port] = from.split(/\s+/);
    r.source = addr;
    if (port) r.extra = true; // puerto de origen
  }
  if (to !== "Anywhere") {
    const spec = portSpec(to);
    const parts = to.split(/\s+/);
    if (spec) Object.assign(r, spec);
    else if (parts.length === 2 && portSpec(parts[1]) && /[.:]/.test(parts[0])) {
      Object.assign(r, portSpec(parts[1]));
      r.extra = true; // solo hacia una de las direcciones del equipo
    } else if (/[.:]\d|\/\d/.test(to) && !UFW_APPS[to]) r.extra = true;
    else {
      r.service = to;
      const app = UFW_APPS[to];
      if (app) Object.assign(r, app);
    }
  }
  const spec = ufwSpec(r);
  r.ref = spec ? { tool: "ufw", spec } : null;
  return r;
}

/** Junta cada regla «(v6)» con su gemela de IPv4: ufw las crea y las quita a la vez. */
function mergeV6(rules: FwRule[]): FwRule[] {
  const key = (r: FwRule) => JSON.stringify([r.verdict, r.dir, r.ports, r.proto, r.service, r.iface, r.source, r.extra]);
  const v4 = new Map<string, FwRule>();
  const out: FwRule[] = [];
  for (const r of rules) {
    if (r.family === "ipv6" && !r.source) {
      const twin = v4.get(key(r));
      if (twin) continue; // ya cubierta (family null = las dos)
    }
    if (r.family !== "ipv6") v4.set(key(r), r);
    out.push(r);
  }
  return out;
}

/** `ufw status verbose` (o `numbered`). */
export function parseUfwStatus(lines: string[]): UfwStatus {
  let active: boolean | null = null;
  let defaults: UfwDefaults | null = null;
  const rules: FwRule[] = [];
  let table = false;
  for (const line of lines) {
    const st = /^Status:\s*(\w+)/.exec(line);
    if (st) active = st[1] === "active";
    else if (/^Default:/.test(line)) defaults = parseUfwDefaults(line);
    else if (/^\s*--\s+-+/.test(line)) table = true;
    else if (table && line.trim()) {
      const r = parseUfwRule(line, `ufw|${rules.length}|${line.trim()}`);
      if (r) rules.push(r);
    }
  }
  return { active, defaults, rules: mergeV6(rules) };
}

/** Separa una línea de comando de ufw respetando las comillas simples y dobles. */
function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Una línea de `ufw show added` («ufw allow from 10.0.0.0/8 to any port 5432 proto tcp»). */
export function parseUfwCommand(line: string, id: string): FwRule | null {
  const w = words(line.trim());
  if (w[0] !== "ufw") return null;
  const args = w.slice(1);
  const ci = args.indexOf("comment");
  const comment = ci >= 0 ? (args[ci + 1] ?? null) : null;
  const a = ci >= 0 ? args.slice(0, ci) : args;
  const verdict = VERDICTS[(a[0] ?? "").toUpperCase()];
  if (!verdict) return null;
  let i = 1;
  let dir: FwDir = "in";
  if (a[i] === "in" || a[i] === "out") dir = a[i++] === "out" ? "out" : "in";
  const r = newRule("ufw", id, line.trim(), "ufw", { verdict, dir, comment });
  if (a[i] !== "from" && a[i] !== "to" && a[i] !== "proto" && a[i] !== "on") {
    const spec = a[i] ? portSpec(a[i]) : null;
    if (spec) Object.assign(r, spec);
    else if (a[i]) {
      r.service = a[i];
      if (UFW_APPS[a[i]]) Object.assign(r, UFW_APPS[a[i]]);
    }
    i++;
  }
  for (; i < a.length; i += 2) {
    const [k, v] = [a[i], a[i + 1] ?? ""];
    if (k === "from") r.source = anySource(v) ? null : v;
    else if (k === "port") r.ports = parsePortList(v) ?? [];
    else if (k === "proto") r.proto = v;
    else if (k === "app") {
      r.service = v;
      if (UFW_APPS[v]) Object.assign(r, UFW_APPS[v]);
    } else if (k === "on") r.iface = v;
    else if (k !== "to" || !anySource(v)) r.extra = true;
  }
  const spec = ufwSpec(r);
  r.ref = spec ? { tool: "ufw", spec } : null;
  return r;
}

export function parseUfwAdded(lines: string[]): FwRule[] {
  return lines.map((l, i) => parseUfwCommand(l, `ufwadd|${i}`)).filter((r): r is FwRule => r !== null);
}
