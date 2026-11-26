// Tipos y utilidades compartidas por las comprobaciones de auditoría.
import type { Check, CheckStatus, Fix } from "../../api/audit";
import type { Summary } from "../../api/vulnscan";
import type { PortsResult, WebResult } from "../admin";

export interface AuditInput {
  /** Salida de AUDIT_SCRIPT. */
  stdout: string;
  /** Se leyó como root. */
  elevated: boolean;
  ports: PortsResult | null;
  web: WebResult | null;
  /** Último informe del escáner (null = nunca se analizó). */
  vuln: { createdAt: string; summary: Summary } | null;
  now: number;
}

export type Family = "rhel" | "fedora" | "debian" | "alpine" | "suse" | "other";

/** Lo que varias comprobaciones necesitan saber del servidor. */
export interface AuditCtx {
  sec: Map<string, string[]>;
  uid: number | null;
  user: string;
  groups: string[];
  os: { id: string; like: string[]; name: string };
  family: Family;
  elevated: boolean;
  sshPort: number;
  passwordAuth: boolean | null;
}

export const NEEDS_SUDO = "Sin comprobar: necesita sudo";

export function lines(ctx: Pick<AuditCtx, "sec">, k: string): string[] {
  return ctx.sec.get(k) ?? [];
}

export function noread(ctx: Pick<AuditCtx, "sec">, k: string): boolean {
  return lines(ctx, k).includes("@noread");
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function check(
  id: string,
  category: Check["category"],
  title: string,
  status: CheckStatus,
  detail: string,
  extra: Partial<Pick<Check, "items" | "fix" | "weight">> = {},
): Check {
  return { id, category, title, status, detail, items: extra.items ?? [], fix: extra.fix ?? null, weight: extra.weight ?? 1 };
}

export function fix(command: string, opts: Partial<Omit<Fix, "command">> = {}): Fix {
  return { command, danger: opts.danger ?? false, manual: opts.manual ?? false, note: opts.note ?? null };
}

export function familyOf(id: string, like: string[]): Family {
  const all = [id, ...like];
  if (id === "fedora") return "fedora";
  if (all.some((x) => ["rhel", "centos", "rocky", "almalinux", "ol", "amzn"].includes(x))) return "rhel";
  if (all.some((x) => ["debian", "ubuntu"].includes(x))) return "debian";
  if (id === "alpine") return "alpine";
  if (all.some((x) => x.includes("suse"))) return "suse";
  return "other";
}

export interface PasswdRow {
  name: string;
  uid: number;
  home: string;
  shell: string;
}

export function parsePasswdLines(ls: string[]): PasswdRow[] {
  return ls
    .map((l) => l.split(":"))
    .filter((p) => p.length >= 4 && /^\d+$/.test(p[1]))
    .map((p) => ({ name: p[0], uid: Number(p[1]), home: p[2], shell: p[3] }));
}

/** Usuarios que pueden usar sudo: grupos sudo/wheel/admin y reglas de sudoers con usuario. */
export function sudoUsers(groups: string[], sudoers: string[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    const p = g.split(":");
    for (const m of (p[3] ?? "").split(",")) if (m.trim() && m.trim() !== "root") out.add(m.trim());
  }
  for (const l of sudoers) {
    if (l === "@noread" || l.startsWith("doas:")) continue;
    const m = /^([a-z_][a-z0-9_.-]*)\s+\S+\s*=/i.exec(l.trim());
    if (m && !["Defaults", "root"].includes(m[1]) && !/_Alias$/.test(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}
