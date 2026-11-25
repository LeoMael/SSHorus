// Cortafuegos: lectura de nftables (`nft -j list ruleset`) con el texto de cada regla (`nft -a list
// ruleset`, por su «# handle N»). Funciones puras.
import { engineOf, newRule } from "./common";
import type { FwChain, FwDir, FwRule, PortRange } from "./types";

type J = Record<string, unknown>;

function obj(v: unknown): J | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as J) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

const HOOK_DIR: Record<string, FwDir> = { input: "in", output: "out", forward: "forward" };

/** Texto de cada regla por «familia tabla|cadena|handle». */
export function nftRuleTexts(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let table = "";
  let chain = "";
  for (const raw of lines) {
    const line = raw.trim();
    const t = /^table\s+(\S+)\s+(\S+)\s*\{/.exec(line);
    if (t) {
      table = `${t[1]} ${t[2]}`;
      continue;
    }
    const c = /^chain\s+(\S+)\s*\{/.exec(line);
    if (c) {
      chain = c[1];
      continue;
    }
    const h = /^(.*?)\s*#\s*handle\s+(\d+)$/.exec(line);
    if (h && chain && !/^(type|policy)\b/.test(h[1])) out.set(`${table}|${chain}|${h[2]}`, h[1]);
  }
  return out;
}

/** Valor de la derecha como puertos (número, {range}, {set}). null = no son puertos. */
function portsOf(v: unknown): PortRange[] | null {
  if (typeof v === "number") return [{ from: v, to: v }];
  const o = obj(v);
  if (o && Array.isArray(o.range) && typeof o.range[0] === "number" && typeof o.range[1] === "number") return [{ from: o.range[0], to: o.range[1] }];
  if (o && Array.isArray(o.set)) {
    const all = o.set.map(portsOf);
    return all.every((x) => x) ? all.flatMap((x) => x ?? []) : null;
  }
  return null;
}

/** Lista de textos (ct state {established, related}, l4proto {tcp, udp}…). */
function stringsOf(v: unknown): string[] | null {
  if (typeof v === "string") return [v];
  const list = Array.isArray(v) ? v : Array.isArray(obj(v)?.set) ? (obj(v)?.set as unknown[]) : null;
  if (!list) return null;
  const out = list.map(str);
  return out.every((x) => x !== null) ? (out as string[]) : null;
}

/** Dirección o red («10.0.0.5», {prefix: {addr, len}}). */
function addrOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  const p = obj(obj(v)?.prefix);
  return p && typeof p.addr === "string" && typeof p.len === "number" ? `${p.addr}/${p.len}` : null;
}

/** Una condición «match» de la regla. Devuelve false si no se entendió. */
function applyMatch(m: J, r: FwRule): boolean {
  const left = obj(m.left);
  const right = m.right;
  if (!left || (m.op !== "==" && m.op !== "in" && m.op !== undefined)) return false;
  const payload = obj(left.payload);
  const meta = obj(left.meta);
  const ct = obj(left.ct);
  if (payload) {
    const proto = str(payload.protocol);
    if (payload.field === "dport") {
      const ports = portsOf(right);
      if (!ports) return false;
      r.ports = ports;
      if (proto === "tcp" || proto === "udp") r.proto = proto;
      return true;
    }
    if (payload.field === "saddr" && (proto === "ip" || proto === "ip6")) {
      r.source = addrOf(right);
      r.family = proto === "ip" ? "ipv4" : "ipv6";
      return r.source !== null;
    }
    if (payload.field === "protocol" || payload.field === "nexthdr") {
      r.proto = str(right);
      return r.proto !== null;
    }
    return false;
  }
  if (meta?.key === "l4proto") {
    const list = stringsOf(right);
    if (list?.length === 1) r.proto = list[0];
    return list?.length === 1;
  }
  if (meta?.key === "iifname" || meta?.key === "iif") {
    r.iface = str(right);
    return r.iface !== null;
  }
  if (meta?.key === "nfproto") {
    const f = str(right);
    r.family = f === "ipv4" ? "ipv4" : f === "ipv6" ? "ipv6" : r.family;
    return f !== null;
  }
  if (ct?.key === "state") {
    const list = stringsOf(right);
    if (list) r.states = list;
    return list !== null;
  }
  return false;
}

const VERDICT_KEYS = ["accept", "drop", "reject", "jump", "goto", "return", "masquerade", "snat", "dnat", "redirect"] as const;
const IGNORED = new Set(["counter", "comment", "limit", "log", "quota", "notrack"]);

function applyExpr(e: J, r: FwRule): void {
  const m = obj(e.match);
  if (m) {
    if (!applyMatch(m, r)) r.extra = true;
    return;
  }
  const key = VERDICT_KEYS.find((k) => k in e);
  if (!key) {
    if ("log" in e && r.verdict === "other") r.verdict = "log";
    if (!Object.keys(e).every((k) => IGNORED.has(k))) r.extra = true;
    return;
  }
  if (key === "accept") r.verdict = "allow";
  else if (key === "drop") r.verdict = "deny";
  else if (key === "reject") r.verdict = "reject";
  else if (key === "return") r.verdict = "return";
  else if (key === "jump" || key === "goto") {
    r.verdict = "jump";
    r.target = str(obj(e[key])?.target);
  } else r.verdict = "nat";
}

/** Cadenas y reglas de `nft -j list ruleset` (null si no es el JSON esperado). */
export function parseNftJson(json: string, texts: Map<string, string> = new Map()): FwChain[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  const items = obj(doc)?.nftables;
  if (!Array.isArray(items)) return null;
  const chains = new Map<string, FwChain>();
  for (const it of items) {
    const c = obj(obj(it)?.chain);
    if (!c) continue;
    const table = `${str(c.family) ?? ""} ${str(c.table) ?? ""}`;
    const name = str(c.name) ?? "";
    const policy = c.policy === "accept" || c.policy === "drop" ? c.policy : null;
    chains.set(`${table}|${name}`, {
      table,
      name,
      hook: str(c.hook),
      type: str(c.type),
      policy,
      rules: [],
      managedBy: engineOf(str(c.table) ?? "") ?? engineOf(name),
    });
  }
  for (const it of items) {
    const rr = obj(obj(it)?.rule);
    if (!rr) continue;
    const table = `${str(rr.family) ?? ""} ${str(rr.table) ?? ""}`;
    const chain = chains.get(`${table}|${str(rr.chain) ?? ""}`);
    if (!chain) continue;
    const handle = str(rr.handle) ?? String(chain.rules.length);
    const exprs = Array.isArray(rr.expr) ? rr.expr : [];
    const raw = texts.get(`${table}|${chain.name}|${handle}`) ?? JSON.stringify(exprs);
    const r = newRule("nftables", `nft|${table}|${chain.name}|${handle}`, raw, `${table} ${chain.name}`, {
      dir: (chain.hook && HOOK_DIR[chain.hook]) || "other",
      comment: str(rr.comment),
      managedBy: chain.managedBy,
    });
    for (const e of exprs) {
      const eo = obj(e);
      if (eo) applyExpr(eo, r);
    }
    // También las que nombran sus interfaces (docker0, podman0…) o saltan a sus cadenas.
    r.managedBy ??= engineOf(r.target ?? "") ?? engineOf(JSON.stringify(exprs));
    chain.rules.push(r);
  }
  const list = [...chains.values()];
  inheritDirection(list);
  return list;
}

/** Las reglas de una cadena normal toman la dirección de la cadena con hook que salta a ella. */
export function inheritDirection(chains: FwChain[]): void {
  const byName = new Map(chains.map((c) => [`${c.table}|${c.name}`, c]));
  const visit = (c: FwChain, dir: FwDir, depth: number) => {
    for (const r of c.rules) {
      if (r.dir === "other") r.dir = dir;
      const t = r.verdict === "jump" && r.target ? byName.get(`${c.table}|${r.target}`) : undefined;
      if (t && !t.hook && depth < 8) visit(t, dir, depth + 1);
    }
  };
  for (const c of chains) {
    const dir = c.hook ? HOOK_DIR[c.hook] : undefined;
    if (dir) visit(c, dir, 0);
  }
}
