// Cortafuegos en palabras simples: cada regla en una frase («Permite entrar por TCP 443 (HTTPS) desde
// cualquier sitio») y las políticas por defecto. Funciones puras.
import { WELL_KNOWN } from "../../admin/ports";
import { portsText } from "./common";
import { rulePorts } from "./reach";
import type { FwChain, FwReport, FwRule, FwTool, FwZone, PortRange } from "./types";

export const TOOL_LABEL: Record<FwTool, string> = { firewalld: "firewalld", ufw: "ufw", nftables: "nftables", iptables: "iptables" };

const ENGINE_LABEL = { docker: "Docker", podman: "Podman" } as const;

export const MANAGED_TEXT = "Creadas por Docker/Podman: no tocar a mano (las rehacen al arrancar los contenedores).";

function protoText(proto: string | null): string {
  if (!proto) return "TCP y UDP";
  if (proto === "icmp" || proto === "ipv6-icmp" || proto === "icmpv6") return "ICMP (ping)";
  return proto.toUpperCase();
}

function portHint(ports: PortRange[]): string {
  const one = ports.length === 1 && ports[0].from === ports[0].to ? WELL_KNOWN[ports[0].from] : undefined;
  return one ? ` (${one})` : "";
}

/** «por TCP 443 (HTTPS)», «por el servicio ssh (TCP 22)», «todo». */
export function whatText(r: FwRule, report: Pick<FwReport, "services">): string {
  if (r.service) {
    const def = rulePorts(r, report);
    const detail = def && def.length ? ` (${def.map((d) => `${protoText(d.proto)} ${portsText(d.ports)}`).join(", ")})` : "";
    return `el servicio «${r.service}»${detail}`;
  }
  if (r.ports.length) return `${protoText(r.proto)} ${portsText(r.ports)}${portHint(r.ports)}`;
  if (r.proto) return `todo el tráfico ${protoText(r.proto)}`;
  return "todo";
}

function sourceText(r: FwRule, only: boolean): string {
  if (!r.source) return " desde cualquier sitio";
  return only ? ` solo desde ${r.source}` : ` desde ${r.source}`;
}

const DIR_VERB: Record<string, string> = { in: "entrar", out: "salir", forward: "pasar hacia otras redes", other: "pasar" };
const DIR_NOUN: Record<string, string> = { in: "la entrada", out: "la salida", forward: "el paso a otras redes", other: "el paso" };

/** La regla en una frase. */
export function ruleText(r: FwRule, report: Pick<FwReport, "services">): string {
  const what = whatText(r, report);
  const via = what === "todo" ? "" : what.startsWith("todo") ? ` ${what}` : ` por ${what}`;
  const iface = r.iface ? ` por la interfaz ${r.iface}` : "";
  const from = (only: boolean) => (r.dir === "out" ? "" : sourceText(r, only)) + iface;
  const fam = r.family ? ` (solo ${r.family === "ipv4" ? "IPv4" : "IPv6"})` : "";
  const more = r.extra ? ". Tiene más condiciones: mira la regla original" : "";
  const onlyReplies = r.states.length > 0 && r.states.every((s) => s === "established" || s === "related");
  let text: string;
  if (r.verdict === "allow" && onlyReplies) text = "Deja pasar las respuestas de las conexiones ya abiertas";
  else if ((r.verdict === "deny" || r.verdict === "reject") && r.states.includes("invalid")) text = "Descarta los paquetes no válidos";
  else if (r.verdict === "allow" && r.iface === "lo" && !r.ports.length && !r.service) text = "Permite el tráfico interno de la propia máquina (lo)";
  else
    switch (r.verdict) {
      case "allow":
      case "limit": {
        const base = `Permite ${DIR_VERB[r.dir]}${via || " cualquier tráfico"}${from(true)}`;
        text = r.verdict === "limit" ? `${base}, pero frena a quien lo intenta muchas veces seguidas` : base;
        break;
      }
      case "deny":
        text = `Bloquea ${DIR_NOUN[r.dir]}${via}${from(false)}`;
        break;
      case "reject":
        text = `Rechaza ${DIR_NOUN[r.dir]}${via}${from(false)} (avisando a quien lo intenta)`;
        break;
      case "jump":
        text = `Pasa a revisar la cadena «${r.target ?? "?"}»${what === "todo" ? "" : ` para ${what}`}${r.source ? sourceText(r, false) : ""}${iface}`;
        break;
      case "return":
        text = "Vuelve a la cadena anterior";
        break;
      case "nat":
        text = natText(r, what);
        break;
      case "log":
        text = `Anota en el registro${via}${from(false)}`;
        break;
      default:
        text = "Regla avanzada";
    }
  const owner = r.managedBy ? ` · de ${ENGINE_LABEL[r.managedBy]}` : "";
  return `${text}${fam}${more}${owner}`;
}

function natText(r: FwRule, what: string): string {
  if (r.raw.startsWith("masquerade") || /masquerade/i.test(r.raw)) return "Comparte la conexión de la máquina con las redes internas (NAT)";
  if (r.target && r.ports.length) return `Redirige ${what} hacia ${r.target}`;
  return "Traduce direcciones (NAT)";
}

// ───────── Políticas por defecto ─────────

function zoneTargetText(target: string): string {
  if (target === "ACCEPT") return "se permite todo";
  if (target === "DROP") return "lo que no está permitido se descarta sin responder";
  return "lo que no está permitido se rechaza";
}

function zoneWhere(z: FwZone): string {
  const parts = [...z.interfaces, ...z.sources];
  if (parts.length) return parts.join(", ");
  return z.isDefault ? "interfaces sin zona" : "sin interfaces";
}

const UFW_POLICY: Record<string, string> = {
  deny: "se bloquea",
  reject: "se rechaza",
  allow: "se permite",
  disabled: "está desactivado",
};

const HOOK_TEXT: Record<string, string> = { input: "entrada", output: "salida", forward: "paso a otras redes" };

function chainPolicy(c: FwChain): string | null {
  const what = c.hook ? HOOK_TEXT[c.hook] : undefined;
  if (!what || (c.type !== null && c.type !== "filter")) return null;
  return `Cadena «${c.table} ${c.name}» (${what}): lo que no encaja en ninguna regla ${c.policy === "drop" ? "se descarta" : "se permite"}.`;
}

/** Qué pasa con lo que no encaja en ninguna regla, en frases. */
export function policyLines(report: FwReport): string[] {
  if (!report.active) return [];
  switch (report.tool) {
    case "firewalld":
      return report.zones
        .filter((z) => z.active || z.isDefault)
        .map((z) => `Zona «${z.name}»${z.isDefault ? " (por defecto)" : ""} · ${zoneWhere(z)}: ${zoneTargetText(z.target)}.`);
    case "ufw": {
      const d = report.ufwDefaults;
      if (!d) return [];
      return [
        `Entrada: lo que no está en la lista ${UFW_POLICY[d.incoming] ?? d.incoming}.`,
        `Salida: ${UFW_POLICY[d.outgoing] ?? d.outgoing}.`,
        `Paso a otras redes (contenedores, router): ${UFW_POLICY[d.routed] ?? d.routed}.`,
      ];
    }
    case "nftables":
    case "iptables":
      return report.chains.filter((c) => !c.managedBy).flatMap((c) => chainPolicy(c) ?? []);
    default:
      return [];
  }
}

/** Estado en una frase («firewalld activo», «ufw instalado pero apagado»…). */
export function statusText(report: FwReport): string {
  if (!report.tool) return report.readable ? "No hay ningún cortafuegos" : "No se sabe (hace falta sudo)";
  const name = TOOL_LABEL[report.tool];
  if (report.active) return `${name} activo`;
  if (!report.readable) return `${name}: sin sudo no se ve si está activo`;
  if (report.tool === "nftables" || report.tool === "iptables") return `${name}: solo hay reglas de Docker/Podman`;
  return `${name} instalado pero apagado`;
}
