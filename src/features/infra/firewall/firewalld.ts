// Cortafuegos: lectura de firewalld (`firewall-cmd --list-all-zones` y los puertos de cada servicio).
// Funciones puras.
import { newRule, parsePortList, parsePortProto } from "./common";
import type { FwRule, FwZone, PortRange } from "./types";

const LIST_KEYS: Record<string, keyof FwZone> = {
  interfaces: "interfaces",
  sources: "sources",
  services: "services",
  ports: "ports",
};

/** Zonas de `firewall-cmd --list-all-zones` (cabecera «public (default, active)», claves «  ports: …»). */
export function parseZones(lines: string[], defaultZone: string | null): FwZone[] {
  const zones: FwZone[] = [];
  let z: FwZone | null = null;
  let cont: "forwardPorts" | "richRules" | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const head = /^(\S+)(?:\s+\(([^)]*)\))?\s*$/.exec(line);
    if (head && !line.startsWith(" ") && !line.startsWith("\t")) {
      const flags = (head[2] ?? "").split(/,\s*/);
      z = {
        name: head[1],
        active: flags.includes("active"),
        isDefault: flags.includes("default") || head[1] === defaultZone,
        target: "default",
        interfaces: [],
        sources: [],
        services: [],
        ports: [],
        masquerade: false,
        forwardPorts: [],
        richRules: [],
      };
      zones.push(z);
      cont = null;
      continue;
    }
    if (!z) continue;
    if (line.startsWith("\t") && cont) {
      z[cont].push(line.trim());
      continue;
    }
    const kv = /^\s+([a-z][a-z -]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    cont = key === "forward-ports" ? "forwardPorts" : key === "rich rules" ? "richRules" : null;
    const words = value.trim() ? value.trim().split(/\s+/) : [];
    const list = LIST_KEYS[key];
    if (list) (z[list] as string[]).push(...words);
    else if (key === "target") z.target = value.trim() || "default";
    else if (key === "masquerade") z.masquerade = value.trim() === "yes";
    else if (cont && value.trim()) z[cont].push(value.trim());
  }
  return zones;
}

/**
 * Puertos de cada servicio a partir de sus XML (sección con líneas «svc nombre» seguidas de las
 * etiquetas `<port protocol="tcp" port="22"/>`).
 */
export function parseServicePorts(lines: string[]): Record<string, { proto: string; ports: PortRange[] }[]> {
  const out: Record<string, { proto: string; ports: PortRange[] }[]> = {};
  let cur: string | null = null;
  for (const line of lines) {
    const svc = /^svc\s+(\S+)$/.exec(line.trim());
    if (svc) {
      cur = svc[1];
      out[cur] = [];
      continue;
    }
    if (!cur) continue;
    const port = /port="([^"]*)"/.exec(line)?.[1];
    const proto = /protocol="([^"]*)"/.exec(line)?.[1];
    const ports = port ? parsePortList(port) : null;
    if (ports && proto) out[cur].push({ proto: proto.toLowerCase(), ports });
  }
  return out;
}

/** Partes de una regla enriquecida («rule family="ipv4" source address="…" port port="…" protocol="…" accept»). */
export function parseRichRule(text: string): Partial<FwRule> {
  const attr = (el: string, name: string) => new RegExp(`\\b${el}\\b[^]*?\\b${name}="([^"]*)"`).exec(text)?.[1] ?? null;
  const family = /\bfamily="(ipv4|ipv6)"/.exec(text)?.[1] as "ipv4" | "ipv6" | undefined;
  const r: Partial<FwRule> = { family: family ?? null };
  const src = /\bsource\s+(NOT\s+)?address="([^"]*)"/.exec(text);
  if (src) {
    r.source = src[2];
    if (src[1]) r.extra = true;
  }
  if (/\bsource\s+(ipset|mac)=|\bsource-port\b|\bdestination\b/.test(text)) r.extra = true;
  const service = /\bservice\s+name="([^"]*)"/.exec(text)?.[1];
  if (service) r.service = service;
  const fwd = /\bforward-port\b/.test(text);
  const portEl = fwd ? "forward-port" : "port";
  const port = /\b(?:forward-)?port\s+port="/.test(text) ? attr(portEl, "port") : null;
  if (port) {
    r.ports = parsePortList(port) ?? [];
    r.proto = attr(portEl, "protocol");
  }
  if (fwd) {
    r.verdict = "nat";
    r.target = [attr("forward-port", "to-addr"), attr("forward-port", "to-port")].filter(Boolean).join(":") || null;
  } else if (/\bmasquerade\b/.test(text)) r.verdict = "nat";
  else if (/\baccept\b/.test(text)) r.verdict = "allow";
  else if (/\breject\b/.test(text)) r.verdict = "reject";
  else if (/\bdrop\b/.test(text)) r.verdict = "deny";
  else if (/\blog\b|\baudit\b/.test(text)) r.verdict = "log";
  if (/\blimit\s+value=/.test(text) && r.verdict === "allow") r.verdict = "limit";
  if (/\bicmp-(block|type)\b|\bprotocol\s+value=/.test(text)) r.extra = true;
  return r;
}

/** «port=80:proto=tcp:toport=8080:toaddr=» → regla de redirección. */
function forwardPort(text: string): Partial<FwRule> {
  const f = Object.fromEntries(text.split(":").map((kv) => kv.split("=") as [string, string]));
  return {
    verdict: "nat",
    proto: f.proto ?? null,
    ports: parsePortList(f.port ?? "") ?? [],
    target: [f.toaddr, f.toport].filter(Boolean).join(":") || null,
  };
}

/** Zonas que de verdad se usan: las activas y la de por defecto (la de las interfaces sin zona). */
export function usedZones(zones: FwZone[]): FwZone[] {
  return zones.filter((z) => z.active || z.isDefault);
}

/** Reglas de las zonas en uso, en el orden en que firewalld las mira (rechazos antes que permisos). */
export function zoneRules(zones: FwZone[], services: Record<string, { proto: string; ports: PortRange[] }[]>): FwRule[] {
  const out: FwRule[] = [];
  for (const z of usedZones(zones)) {
    const id = (x: string) => `firewalld|${z.name}|${x}`;
    const rich = z.richRules.map((text) => newRule("firewalld", id(`rich:${text}`), text, z.name, { ...parseRichRule(text), ref: { tool: "firewalld", zone: z.name, kind: "rich", value: text } }));
    // firewalld aplica primero las reglas enriquecidas de registrar y rechazar, y después las de permitir.
    out.push(...rich.filter((r) => r.verdict === "deny" || r.verdict === "reject" || r.verdict === "log"));
    for (const s of z.services) {
      const def = services[s] ?? [];
      const protos = [...new Set(def.map((d) => d.proto))];
      out.push(
        newRule("firewalld", id(`svc:${s}`), `services: ${s}`, z.name, {
          verdict: "allow",
          service: s,
          proto: protos.length === 1 ? protos[0] : null,
          ports: def.flatMap((d) => d.ports),
          ref: { tool: "firewalld", zone: z.name, kind: "service", value: s },
        }),
      );
    }
    for (const p of z.ports) {
      const pp = parsePortProto(p);
      out.push(
        newRule("firewalld", id(`port:${p}`), `ports: ${p}`, z.name, {
          verdict: "allow",
          proto: pp?.proto ?? null,
          ports: pp?.ports ?? [],
          extra: !pp,
          ref: { tool: "firewalld", zone: z.name, kind: "port", value: p },
        }),
      );
    }
    out.push(...rich.filter((r) => r.verdict !== "deny" && r.verdict !== "reject" && r.verdict !== "log"));
    for (const f of z.forwardPorts) {
      out.push(newRule("firewalld", id(`fwd:${f}`), `forward-ports: ${f}`, z.name, { ...forwardPort(f), ref: { tool: "firewalld", zone: z.name, kind: "forward", value: f } }));
    }
    if (z.masquerade) {
      out.push(newRule("firewalld", id("masq"), "masquerade: yes", z.name, { verdict: "nat", dir: "forward", ref: { tool: "firewalld", zone: z.name, kind: "masquerade", value: "" } }));
    }
  }
  return out;
}
