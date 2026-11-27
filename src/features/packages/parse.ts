// Paquetes: lectura de las actualizaciones pendientes (`dnf check-update`, `apt list --upgradable`,
// `zypper list-updates`, `apk list -u`), de cuáles son de seguridad, de una búsqueda y de lo que quitaría
// un «quitar» simulado. Funciones puras, sin React ni Tauri.
import { splitSections } from "../../lib/remote";

export type PkgManager = "dnf" | "yum" | "apt" | "zypper" | "apk" | "none";

export interface Upgrade {
  name: string;
  arch: string | null;
  /** Versión nueva. */
  version: string;
  /** Versión instalada (null = el gestor no la dice, p. ej. dnf). */
  current: string | null;
  repo: string | null;
  /** La distro la marca como de seguridad. */
  security: boolean;
}

const ARCH = "x86_64|noarch|aarch64|i686|i586|i386|ppc64le|ppc64|s390x|armv7hl|armhfp|riscv64|amd64|arm64|armhf|all|src";
const NAME_ARCH_RE = new RegExp(`^([A-Za-z0-9_.+-]+)\\.(${ARCH})$`);
/** Nombre-[época:]versión-revisión.arquitectura («openssl-libs-1:3.0.7-27.el9.x86_64»). */
const NEVRA_RE = new RegExp(`^(.+)-(?:\\d+:)?[^-]+-[^-]+\\.(${ARCH})$`);

/** `dnf check-update` / `yum check-update`: «nombre.arch  versión  repositorio» (a veces partido en dos líneas). */
export function parseDnfUpdates(lines: string[]): Upgrade[] {
  const out: Upgrade[] = [];
  let pending: string | null = null;
  for (const line of lines) {
    if (/^(Obsoleting|Security:|Last metadata|Updating and loading|Repositories loaded)/i.test(line.trim())) {
      if (/^Obsoleting/i.test(line.trim())) break;
      continue;
    }
    const t = line.trim().split(/\s+/).filter(Boolean);
    if (pending && t.length >= 2 && /^\s/.test(line)) t.unshift(pending);
    pending = null;
    if (t.length === 1 && NAME_ARCH_RE.test(t[0])) {
      pending = t[0];
      continue;
    }
    const m = t.length >= 3 ? NAME_ARCH_RE.exec(t[0]) : null;
    if (!m || !/^[0-9]/.test(t[1].replace(/^\d+:/, "0"))) continue;
    out.push({ name: m[1], arch: m[2], version: t[1], current: null, repo: t[2], security: false });
  }
  return out;
}

/** `dnf updateinfo list --security` (dnf 4 y dnf 5): nombres de los paquetes con aviso de seguridad. */
export function parseDnfSecurity(lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    if (!/sec/i.test(line)) continue;
    for (const tok of line.trim().split(/\s+/)) {
      const m = NEVRA_RE.exec(tok);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

const APT_RE = /^([^/\s]+)\/(\S+)\s+(\S+)\s+(\S+)(?:\s+\[upgradable from: ([^\]]+)\])?/;

/** `apt list --upgradable`: «curl/jammy-updates,jammy-security 7.81.0-1ubuntu1.16 amd64 [upgradable from: …]». */
export function parseAptUpdates(lines: string[]): Upgrade[] {
  const out: Upgrade[] = [];
  for (const line of lines) {
    const m = APT_RE.exec(line.trim());
    if (!m) continue;
    const suites = m[2].split(",");
    out.push({
      name: m[1],
      arch: m[4],
      version: m[3],
      current: m[5] ?? null,
      repo: suites.join(", "),
      security: suites.some((s) => /(^|-)security$/.test(s) || /\/security/.test(s)),
    });
  }
  return out;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z-]+)="([^"]*)"/g)) out[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return out;
}

/** `zypper --xmlout list-updates`: `<update kind="package" name=… edition=… edition-old=… arch=…>`. */
export function parseZypperUpdates(lines: string[]): Upgrade[] {
  const out: Upgrade[] = [];
  const text = lines.join("\n");
  for (const m of text.matchAll(/<update\s([^>]*)>([\s\S]*?)<\/update>|<update\s([^>]*)\/>/g)) {
    const a = attrs(m[1] ?? m[3] ?? "");
    if ((a.kind ?? "package") !== "package" || !a.name) continue;
    const src = /<source\s[^>]*alias="([^"]*)"/.exec(m[2] ?? "");
    out.push({ name: a.name, arch: a.arch ?? null, version: a.edition ?? "?", current: a["edition-old"] || null, repo: src?.[1] ?? null, security: false });
  }
  return out;
}

const APK_VER = /^(.+)-([^-]+-r\d+)$/;

/** `apk list -u` («busybox-1.36.1-r29 x86_64 {busybox} (…) [upgradable from: busybox-1.36.1-r28]») o `apk version -l '<'`. */
export function parseApkUpdates(lines: string[]): Upgrade[] {
  const out: Upgrade[] = [];
  for (const line of lines) {
    const t = line.trim();
    const list = /^(\S+)\s+(\S+)\s+\{[^}]*\}.*\[upgradable from: (\S+)\]/.exec(t);
    if (list) {
      const now = APK_VER.exec(list[1]);
      const old = APK_VER.exec(list[3]);
      if (now) out.push({ name: now[1], arch: list[2], version: now[2], current: old?.[2] ?? null, repo: null, security: false });
      continue;
    }
    const ver = /^(\S+)\s+<\s+(\S+)/.exec(t);
    const cur = ver ? APK_VER.exec(ver[1]) : null;
    if (ver && cur) out.push({ name: cur[1], arch: null, version: ver[2], current: cur[2], repo: null, security: false });
  }
  return out;
}

export interface UpdatesRead {
  manager: PkgManager;
  updates: Upgrade[];
  /** Parches o avisos de seguridad pendientes (null = la distro no lo dice). */
  securityCount: number | null;
  /** Kernel en uso (`uname -r`). */
  kernel: string | null;
  /** El gestor falló (sin red, sin caché, sin permiso): su mensaje. */
  error: string | null;
  /** Avisos del gestor aunque saliera bien (repositorio caído, etc.). */
  warning: string | null;
  root: boolean;
}

/** Salida de updatesScript. */
export function parseUpdatesOutput(stdout: string): UpdatesRead {
  const s = splitSections(stdout);
  const manager = ((s.get("mgr") ?? [])[0]?.trim() || "none") as PkgManager;
  const lines = s.get("updates") ?? [];
  const rc = Number((s.get("rc") ?? [])[0] ?? "0");
  const err = (s.get("err") ?? []).filter((l) => !/^(Last metadata|Updating and loading|Repositories loaded|Loading repository|Reading installed|Retrieving repository|Building repository|WARNING: apt does not have a stable CLI|^$)/.test(l.trim())).join("\n").trim();
  const sec = s.get("sec") ?? [];
  let updates: Upgrade[] = [];
  let securityCount: number | null = null;
  if (manager === "dnf" || manager === "yum") {
    updates = parseDnfUpdates(lines);
    const names = parseDnfSecurity(sec);
    for (const u of updates) u.security = names.has(u.name);
    securityCount = updates.filter((u) => u.security).length;
  } else if (manager === "apt") {
    updates = parseAptUpdates(lines);
    securityCount = updates.filter((u) => u.security).length;
  } else if (manager === "zypper") {
    updates = parseZypperUpdates(lines);
    const n = Number(sec[0]);
    securityCount = Number.isFinite(n) && sec.length ? n : null;
  } else if (manager === "apk") {
    updates = parseApkUpdates(lines);
  }
  // dnf: 100 = hay actualizaciones, 1 = error. zypper: 100 o más son avisos. El resto: distinto de 0 = error.
  const failed = manager === "dnf" || manager === "yum" ? rc === 1 : manager === "zypper" ? rc !== 0 && rc < 100 : rc !== 0;
  return {
    manager,
    updates: updates.sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name)),
    securityCount,
    kernel: (s.get("kernel") ?? [])[0]?.trim() || null,
    error: failed ? err || `El gestor de paquetes terminó con código ${rc}` : null,
    warning: failed ? null : err.slice(0, 1500) || null,
    root: (s.get("root") ?? [])[0]?.trim() === "0",
  };
}
