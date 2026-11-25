// Cortafuegos: script de lectura (con sudo) y su salida convertida en un informe. Decide qué herramienta
// manda (firewalld, ufw, nftables o iptables) y separa las reglas de Docker/Podman. Funciones puras.
import { splitSections } from "../../../lib/remote";
import { engineOf } from "./common";
import { parseServicePorts, parseZones, zoneRules } from "./firewalld";
import { parseIptablesSave } from "./iptables";
import { nftRuleTexts, parseNftJson } from "./nft";
import type { FwChain, FwReport, FwRule, FwTool, IfaceAddr } from "./types";
import { parseUfwAdded, parseUfwStatus } from "./ufw";

/**
 * Secciones: @@uid · @@ifaddr («interfaz ip») · @@tools («firewalld running», «ufw inactive», «ufw ?»
 * sin permiso, «nftables json») · @@fwddef · @@fwdzones · @@fwdsvc · @@ufw (status verbose) · @@ufwadd
 * (show added) · @@nftj (JSON) · @@nftt (texto con handles) · @@ipt (iptables-save, si no hay nft).
 */
export const FIREWALL_SCRIPT = [
  "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin",
  "echo @@uid; id -u",
  "echo @@ifaddr",
  "ip -o addr show 2>/dev/null | awk '{sub(/\\/.*/, \"\", $4); print $2\" \"$4}'",
  "echo @@tools",
  "FWD=''; if command -v firewall-cmd >/dev/null 2>&1; then FWD=$(firewall-cmd --state 2>/dev/null || echo 'not running'); echo \"firewalld $FWD\"; fi",
  "UFW=''; if command -v ufw >/dev/null 2>&1; then UFW=$(ufw status verbose 2>/dev/null); s=$(printf '%s\\n' \"$UFW\" | awk '/^Status:/{print $2; exit}'); echo \"ufw ${s:-?}\"; fi",
  "NJ=''; if command -v nft >/dev/null 2>&1; then NJ=$(nft -j list ruleset 2>/dev/null); [ -n \"$NJ\" ] && echo 'nftables json'; fi",
  "if [ \"$FWD\" = running ]; then",
  "  echo @@fwddef; firewall-cmd --get-default-zone 2>/dev/null",
  "  Z=$(firewall-cmd --list-all-zones 2>/dev/null)",
  "  echo @@fwdzones; printf '%s\\n' \"$Z\"",
  "  echo @@fwdsvc",
  "  for s in $(printf '%s\\n' \"$Z\" | awk '/^  services:/{for(i=2;i<=NF;i++)print $i}' | sort -u); do",
  "    echo \"svc $s\"",
  "    for d in /etc/firewalld/services /usr/lib/firewalld/services; do [ -r \"$d/$s.xml\" ] && { grep -o '<port [^>]*>' \"$d/$s.xml\"; break; }; done",
  "  done",
  "fi",
  "if [ -n \"$UFW\" ]; then echo @@ufw; printf '%s\\n' \"$UFW\"; echo @@ufwadd; ufw show added 2>/dev/null; fi",
  "if [ -n \"$NJ\" ]; then echo @@nftj; printf '%s\\n' \"$NJ\"; echo @@nftt; nft -a list ruleset 2>/dev/null",
  "elif command -v iptables-save >/dev/null 2>&1; then echo @@ipt; iptables-save 2>/dev/null; fi",
  "echo @@end",
].join("\n");

export const NEEDS_SUDO_TEXT = "Para ver las reglas hace falta sudo: sin él solo se sabe qué cortafuegos hay.";

function parseTools(lines: string[]): { tool: FwTool; state: string }[] {
  const out: { tool: FwTool; state: string }[] = [];
  for (const l of lines) {
    const [t, ...rest] = l.trim().split(/\s+/);
    if (t === "firewalld" || t === "ufw") out.push({ tool: t, state: rest.join(" ") });
  }
  return out;
}

function parseIfaces(lines: string[]): IfaceAddr[] {
  return lines
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 2 && p[1])
    .map(([iface, ip]) => ({ iface, ip }));
}

/** Las cadenas propias del sistema que filtran algo (sin las de Docker/Podman ni la de firewalld). */
function ownChains(chains: FwChain[]): FwChain[] {
  return chains.filter((c) => !c.managedBy && !/\bfirewalld\b/.test(c.table) && (c.rules.length > 0 || c.policy === "drop"));
}

function managedOf(chains: FwChain[]): FwRule[] {
  return chains.flatMap((c) => c.rules.filter((r) => r.managedBy));
}

export function parseFirewallReport(stdout: string): FwReport {
  const s = splitSections(stdout);
  const get = (k: string) => s.get(k) ?? [];
  const root = get("uid")[0]?.trim() === "0";
  const installed = parseTools(get("tools"));
  const state = (t: FwTool) => installed.find((i) => i.tool === t)?.state ?? null;
  const nftJson = get("nftj").join("\n");
  const chains = (nftJson ? parseNftJson(nftJson, nftRuleTexts(get("nftt"))) : null) ?? parseIptablesSave(get("ipt"));
  const chainTool: FwTool = nftJson ? "nftables" : "iptables";
  const report: FwReport = {
    tool: null,
    active: false,
    installed,
    readable: root,
    rules: [],
    managed: managedOf(chains),
    zones: [],
    defaultZone: null,
    services: {},
    ufwDefaults: null,
    ufwAdded: parseUfwAdded(get("ufwadd")),
    chains: [],
    ifaces: parseIfaces(get("ifaddr")),
    notes: [],
  };
  const withNote = (r: FwReport): FwReport => (r.readable ? r : { ...r, notes: [NEEDS_SUDO_TEXT, ...r.notes] });
  if (state("firewalld") === "running") {
    report.defaultZone = get("fwddef")[0]?.trim() || null;
    report.zones = parseZones(get("fwdzones"), report.defaultZone);
    report.services = parseServicePorts(get("fwdsvc"));
    const rules = zoneRules(report.zones, report.services);
    for (const r of rules) r.managedBy = engineOf(r.place);
    report.rules = rules.filter((r) => !r.managedBy);
    report.managed.unshift(...rules.filter((r) => r.managedBy));
    // Con polkit, firewall-cmd a veces responde sin root: entonces las reglas también se ven.
    return withNote({ ...report, tool: "firewalld", active: true, readable: root || report.zones.length > 0 });
  }
  const ufw = parseUfwStatus(get("ufw"));
  report.ufwDefaults = ufw.defaults;
  if (ufw.active) return withNote({ ...report, tool: "ufw", active: true, rules: ufw.rules, readable: true });
  const own = ownChains(chains);
  if (own.length) {
    report.chains = chains.filter((c) => !/\bfirewalld\b/.test(c.table));
    report.rules = own.flatMap((c) => c.rules.filter((r) => !r.managedBy));
    return withNote({ ...report, tool: chainTool, active: true });
  }
  const manager = installed.find((i) => i.tool === "firewalld") ?? installed.find((i) => i.tool === "ufw");
  if (manager) return withNote({ ...report, tool: manager.tool, readable: root || (manager.tool === "ufw" && ufw.active === false) });
  return withNote(report.managed.length ? { ...report, tool: chainTool } : report);
}

/** SSHorus sabe cambiar las reglas de esta herramienta (nftables e iptables, de momento solo se ven). */
export function canManage(r: FwReport): boolean {
  return r.readable && (r.tool === "firewalld" || r.tool === "ufw");
}
