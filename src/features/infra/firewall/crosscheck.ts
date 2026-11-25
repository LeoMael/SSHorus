// Cortafuegos frente a los puertos en escucha (los de Administración → Puertos): lo que escucha pero
// no se puede alcanzar y lo que está abierto sin nada detrás. Funciones puras.
import { WELL_KNOWN, type ListenPort } from "../../admin/ports";
import { reach, rulePorts } from "./reach";
import type { FwReport } from "./types";

export type FindingKind = "listen-blocked" | "open-idle" | "open-local" | "docker-bypass";

export interface FwFinding {
  kind: FindingKind;
  port: number;
  proto: "tcp" | "udp";
  text: string;
}

function name(port: number, proto: string): string {
  const known = WELL_KNOWN[port];
  return `${port}/${proto}${known ? ` (${known})` : ""}`;
}

/** Puertos sueltos que el cortafuegos abre a todo el mundo por una regla explícita (los rangos no). */
export function openedPorts(report: FwReport): { port: number; proto: "tcp" | "udp" }[] {
  const out = new Map<string, { port: number; proto: "tcp" | "udp" }>();
  for (const r of report.rules) {
    if ((r.verdict !== "allow" && r.verdict !== "limit") || r.dir !== "in" || r.source || r.iface || r.extra) continue;
    // Los servicios «…-client» (dhcpv6-client) son respuestas a lo que pide la máquina, no algo que escucha.
    if (r.service?.endsWith("-client")) continue;
    for (const def of rulePorts(r, report) ?? []) {
      const protos = def.proto ? [def.proto] : ["tcp", "udp"];
      for (const { from: port, to } of def.ports) {
        if (port !== to) continue;
        for (const proto of protos) if (proto === "tcp" || proto === "udp") out.set(`${port}/${proto}`, { port, proto });
      }
    }
  }
  return [...out.values()];
}

const DOCKER_PROXY = /^docker-proxy$/;

/** Avisos al cruzar el cortafuegos con los puertos en escucha (null = no se leyeron los puertos). */
export function crossCheck(report: FwReport, ports: ListenPort[] | null): FwFinding[] {
  if (!ports || !report.readable || !report.active) return [];
  const out: FwFinding[] = [];
  const seen = new Set<string>();
  for (const p of ports) {
    const key = `${p.port}/${p.proto}`;
    if (p.scope === "local" || seen.has(key)) continue;
    seen.add(key);
    if (reach(report, { port: p.port, proto: p.proto }) !== "blocked") continue;
    if (p.procs.some((x) => DOCKER_PROXY.test(x.name))) {
      out.push({ kind: "docker-bypass", port: p.port, proto: p.proto, text: `${name(p.port, p.proto)} lo publica Docker: se puede llegar aunque el cortafuegos diga que no.` });
    } else {
      out.push({ kind: "listen-blocked", port: p.port, proto: p.proto, text: `${name(p.port, p.proto)} escucha, pero el cortafuegos no deja llegar desde fuera.` });
    }
  }
  for (const o of openedPorts(report)) {
    const listening = ports.filter((p) => p.port === o.port && p.proto === o.proto);
    if (listening.length === 0) {
      out.push({ kind: "open-idle", ...o, text: `${name(o.port, o.proto)} está abierto en el cortafuegos, pero no hay nada escuchando.` });
    } else if (listening.every((p) => p.scope === "local")) {
      out.push({ kind: "open-local", ...o, text: `${name(o.port, o.proto)} está abierto, pero solo escucha dentro de la máquina: desde fuera no responde.` });
    }
  }
  return out;
}
