// Cortafuegos: lo que se escribe en «Abrir puerto o servicio» comprobado y convertido en un cambio.
// Funciones puras.
import { isIpOrNet, parsePortList } from "./common";
import type { FwTarget } from "./commands";
import { UFW_APPS } from "./ufw";

export interface RuleForm {
  kind: "port" | "service";
  /** «443» o «8000-8010». */
  port: string;
  proto: "tcp" | "udp";
  service: string;
  /** Vacío = desde cualquier sitio. */
  source: string;
}

export const EMPTY_FORM: RuleForm = { kind: "port", port: "", proto: "tcp", service: "", source: "" };

/** Nombres de servicio de firewalld y perfiles de ufw («http», «Nginx Full»). */
const SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.+-]{0,63}$/;

export function formTarget(f: RuleForm): { target: FwTarget } | { error: string } {
  const source = f.source.trim() || null;
  if (source && !isIpOrNet(source)) return { error: "El origen debe ser una IP o una red (por ejemplo 203.0.113.4 o 10.0.0.0/8)." };
  if (f.kind === "service") {
    const name = f.service.trim();
    if (!SERVICE_RE.test(name)) return { error: "Escribe el nombre del servicio (por ejemplo http o https)." };
    return { target: { kind: "service", name, source } };
  }
  const ports = parsePortList(f.port.trim());
  if (!ports || ports.length !== 1) return { error: "Escribe un puerto (1-65535) o un rango como 8000-8010." };
  return { target: { kind: "port", ports: ports[0], proto: f.proto, source } };
}

const FIREWALLD_COMMON = ["http", "https", "ssh", "dns", "smtp", "imaps", "postgresql", "mysql", "redis", "cockpit"];

/** Nombres de servicio que ofrecer al escribir (los de esa herramienta). */
export function serviceSuggestions(tool: "firewalld" | "ufw", known: string[]): string[] {
  return [...new Set(tool === "ufw" ? Object.keys(UFW_APPS) : [...known, ...FIREWALLD_COMMON])].sort();
}
