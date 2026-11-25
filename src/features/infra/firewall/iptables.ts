// Cortafuegos: lectura de iptables «a la antigua» (`iptables-save`), para servidores sin nftables.
// Funciones puras.
import { engineOf, newRule, parsePortList } from "./common";
import { inheritDirection } from "./nft";
import type { FwChain, FwDir, FwRule, FwVerdict } from "./types";

const BUILTIN: Record<string, string> = { INPUT: "input", OUTPUT: "output", FORWARD: "forward", PREROUTING: "prerouting", POSTROUTING: "postrouting" };
const HOOK_DIR: Record<string, FwDir> = { input: "in", output: "out", forward: "forward" };
const TARGETS: Record<string, FwVerdict> = {
  ACCEPT: "allow",
  DROP: "deny",
  REJECT: "reject",
  RETURN: "return",
  LOG: "log",
  MASQUERADE: "nat",
  DNAT: "nat",
  SNAT: "nat",
  REDIRECT: "nat",
};
/** Módulos y opciones que no cambian qué tráfico encaja (o que ya se leen por su opción). */
const NEUTRAL = new Set(["-m", "--log-prefix", "--log-level", "--reject-with", "--to-destination", "--to-source", "--to-ports", "--icmp-type", "--tcp-flags", "--syn"]);

/** Separa los argumentos respetando las comillas dobles (los comentarios). */
function args(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/** Una línea «-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT» de la tabla `table`. */
function parseRule(line: string, table: string, chain: FwChain, i: number): FwRule {
  const a = args(line).slice(2);
  const r = newRule("iptables", `ipt|${table}|${chain.name}|${i}`, line, `${table} ${chain.name}`, { dir: "other", managedBy: chain.managedBy });
  for (let k = 0; k < a.length; k++) {
    const opt = a[k];
    const val = a[k + 1] ?? "";
    const take = () => {
      k++;
      return val;
    };
    if (opt === "!") {
      r.extra = true;
    } else if (opt === "-p" || opt === "--protocol") r.proto = take().toLowerCase();
    else if (opt === "--dport" || opt === "--dports" || opt === "--destination-port") {
      const ports = parsePortList(take());
      if (ports) r.ports = ports;
      else r.extra = true;
    } else if (opt === "-s" || opt === "--source") {
      const v = take();
      r.source = v === "0.0.0.0/0" || v === "::/0" ? null : v.replace(/\/(32|128)$/, "");
    } else if (opt === "-i" || opt === "--in-interface") r.iface = take();
    else if (opt === "--ctstate" || opt === "--state") r.states = take().toLowerCase().split(",");
    else if (opt === "--comment") r.comment = take();
    else if (opt === "-j" || opt === "-g" || opt === "--jump" || opt === "--goto") {
      const t = take();
      r.verdict = TARGETS[t] ?? "jump";
      if (r.verdict === "jump") r.target = t;
    } else if (NEUTRAL.has(opt)) {
      if (opt !== "--syn") k++;
    } else if (opt.startsWith("-")) {
      r.extra = true;
      if (!(a[k + 1] ?? "-").startsWith("-")) k++;
    }
  }
  // También las que nombran sus interfaces (docker0, podman0…) o saltan a sus cadenas.
  r.managedBy ??= engineOf(r.target ?? "") ?? engineOf(a.join(" "));
  return r;
}

/** Cadenas de `iptables-save` (todas las tablas; el tipo de la cadena es el nombre de la tabla). */
export function parseIptablesSave(lines: string[]): FwChain[] {
  const chains = new Map<string, FwChain>();
  let table = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("*")) {
      table = line.slice(1);
      continue;
    }
    const def = /^:(\S+)\s+(\S+)/.exec(line);
    if (def && table) {
      const hook = BUILTIN[def[1]] ?? null;
      const policy = def[2] === "ACCEPT" ? "accept" : def[2] === "DROP" ? "drop" : null;
      chains.set(`${table}|${def[1]}`, { table, name: def[1], hook, type: table, policy, rules: [], managedBy: engineOf(def[1]) });
      continue;
    }
    const add = /^-A\s+(\S+)/.exec(line);
    const chain = add ? chains.get(`${table}|${add[1]}`) : undefined;
    if (!chain) continue;
    const r = parseRule(line, table, chain, chain.rules.length);
    if (chain.hook) r.dir = HOOK_DIR[chain.hook] ?? "other";
    chain.rules.push(r);
  }
  const list = [...chains.values()];
  inheritDirection(list);
  return list;
}
