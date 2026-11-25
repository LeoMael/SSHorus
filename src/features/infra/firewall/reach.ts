// Cortafuegos: ¿se puede llegar a un puerto desde fuera? Recorre las reglas como lo haría la
// herramienta (la primera que encaja decide; si no encaja ninguna, la política por defecto). Lo que no
// se sabe leer (condiciones raras, interfaces, servicios sin definición) da «no se sabe». Funciones puras.
import { inRanges, ipInNet } from "./common";
import type { FwChain, FwReport, FwRule, FwZone, PortRange } from "./types";
import { UFW_APPS } from "./ufw";

export type Reach = "allowed" | "blocked" | "unknown";

export interface ReachQuery {
  port: number;
  proto: "tcp" | "udp";
  /** IP de quien entra (null = «desde cualquier sitio»: no cuentan las reglas para un origen concreto). */
  from?: string | null;
  /** IP del servidor a la que llega (para saber la interfaz y su zona). */
  localIp?: string | null;
}

type Match = "yes" | "no" | "maybe";
type Outcome = Reach | "continue";

/** Puertos que abre la regla (resuelve servicios). [] = todos; null = no se sabe. */
export function rulePorts(r: FwRule, report: Pick<FwReport, "services">): { proto: string | null; ports: PortRange[] }[] | null {
  if (r.ports.length) return [{ proto: r.proto, ports: r.ports }];
  if (!r.service) return [];
  const def = report.services[r.service] ?? (UFW_APPS[r.service] ? [UFW_APPS[r.service]] : null);
  return def && def.length ? def : null;
}

/** La regla abarca ese puerto (por número o por su servicio). null = no se sabe. */
export function ruleCovers(r: FwRule, port: number, proto: string, report: Pick<FwReport, "services">): boolean | null {
  if (r.proto && r.proto !== proto && r.ports.length) return false;
  const list = rulePorts(r, report);
  if (list === null) return null;
  if (list.length === 0) return !r.proto || r.proto === proto;
  return list.some((p) => (!p.proto || p.proto === proto) && inRanges(port, p.ports));
}

function familyOf(ip: string): "ipv4" | "ipv6" {
  return ip.includes(":") ? "ipv6" : "ipv4";
}

function matchRule(r: FwRule, q: ReachQuery, report: FwReport, iface: string | null): Match {
  if (r.dir !== "in") return "no";
  if (r.states.length && !r.states.includes("new")) return "no";
  if (r.proto && r.proto !== q.proto) return "no";
  if (r.iface === "lo" || (r.iface && iface && r.iface !== iface)) return "no";
  const covers = ruleCovers(r, q.port, q.proto, report);
  if (covers === false) return "no";
  if (r.family && q.from && r.family !== familyOf(q.from)) return "no";
  let sure = covers !== null && !r.extra && (!r.iface || r.iface === iface);
  if (r.source) {
    if (!q.from) return "no";
    const inside = ipInNet(q.from, r.source);
    if (inside === false) return "no";
    if (inside === null) sure = false;
  }
  return sure ? "yes" : "maybe";
}

/** La primera que encaja decide; si antes hubo una que «quizá» encajaba con otro resultado, no se sabe. */
function decide(steps: { m: Match; out: () => Outcome | "return" }[], fallback: Outcome): Outcome {
  const maybes = new Set<Outcome>();
  const settle = (o: Outcome): Outcome => {
    if (o === "unknown") return o;
    for (const x of maybes) if (x !== o) return "unknown";
    return o;
  };
  for (const s of steps) {
    if (s.m === "no") continue;
    const raw = s.out();
    const o: Outcome = raw === "return" ? "continue" : raw;
    if (s.m === "maybe") {
      if (raw !== "continue") maybes.add(o);
      continue;
    }
    if (raw === "return") return settle("continue");
    if (o !== "continue") return settle(o);
  }
  return settle(fallback);
}

function verdictOutcome(r: FwRule): Outcome | "return" {
  if (r.verdict === "allow" || r.verdict === "limit") return "allowed";
  if (r.verdict === "deny" || r.verdict === "reject") return "blocked";
  if (r.verdict === "return") return "return";
  return "continue";
}

function combine(list: Outcome[]): Reach {
  if (list.length === 0) return "allowed";
  if (list.includes("blocked")) return "blocked";
  if (list.every((o) => o === "allowed" || o === "continue")) return "allowed";
  return "unknown";
}

// ───────── firewalld ─────────

function zonesFor(report: FwReport, q: ReachQuery, iface: string | null): FwZone[] {
  const used = report.zones.filter((z) => z.active || z.isDefault);
  if (q.from) {
    const bySource = used.find((z) => z.sources.some((s) => ipInNet(q.from!, s) === true));
    if (bySource) return [bySource];
  }
  const def = used.filter((z) => z.isDefault);
  if (iface) return [used.find((z) => z.interfaces.includes(iface)) ?? def[0]].filter((z): z is FwZone => !!z);
  const withIfaces = used.filter((z) => z.interfaces.some((i) => i !== "lo"));
  return withIfaces.length ? withIfaces : def;
}

function zoneOutcome(z: FwZone, q: ReachQuery, report: FwReport, iface: string | null): Outcome {
  if (z.target === "ACCEPT") return "allowed";
  const rules = report.rules.filter((r) => r.place === z.name);
  return decide(
    rules.map((r) => ({ m: matchRule(r, q, report, iface), out: () => verdictOutcome(r) })),
    "blocked",
  );
}

// ───────── nftables / iptables ─────────

function chainOutcome(c: FwChain, q: ReachQuery, report: FwReport, all: Map<string, FwChain>, depth: number): Outcome {
  const steps = c.rules.map((r) => ({
    m: matchRule(r, q, report, null),
    out: (): Outcome | "return" => {
      if (r.verdict !== "jump") return verdictOutcome(r);
      const t = all.get(`${c.table}|${r.target ?? ""}`);
      return t && depth < 8 ? chainOutcome(t, q, report, all, depth + 1) : "unknown";
    },
  }));
  const fallback: Outcome = !c.hook ? "continue" : c.policy === "drop" ? "blocked" : "allowed";
  return decide(steps, fallback);
}

function isInputFilter(c: FwChain): boolean {
  return c.hook === "input" && (c.type === "filter" || c.type === null);
}

/** ¿Llega una conexión nueva a ese puerto? */
export function reach(report: FwReport, q: ReachQuery): Reach {
  if (!report.readable) return "unknown";
  if (!report.tool || !report.active) return "allowed";
  const iface = q.localIp ? (report.ifaces.find((i) => i.ip === q.localIp)?.iface ?? null) : null;
  switch (report.tool) {
    case "firewalld":
      return combine(zonesFor(report, q, iface).map((z) => zoneOutcome(z, q, report, iface)));
    case "ufw": {
      const d = report.ufwDefaults?.incoming;
      const fallback: Outcome = d === "allow" ? "allowed" : d === "deny" || d === "reject" ? "blocked" : "unknown";
      return combine([decide(report.rules.map((r) => ({ m: matchRule(r, q, report, iface), out: () => verdictOutcome(r) })), fallback)]);
    }
    default: {
      const all = new Map(report.chains.map((c) => [`${c.table}|${c.name}`, c]));
      return combine(report.chains.filter(isInputFilter).map((c) => chainOutcome(c, q, report, all, 0)));
    }
  }
}
