// Servicios del servidor: lectura de `systemctl list-units` / `list-unit-files` (systemd, del sistema o
// `--user` de un usuario) y de `rc-status` / `rc-update` (OpenRC, Alpine). Funciones puras.
import { splitSections } from "../../lib/remote";

export type InitSystem = "systemd" | "openrc" | "none";

/** Estado en palabras: «activo», «caído», «parado», «arrancando». */
export type RunState = "running" | "failed" | "stopped" | "starting" | "other";

/** Si arranca solo al encender: `enabled` / `disabled` / `static` (lo arranca otro) / `masked` (bloqueado). */
export type BootState = "enabled" | "disabled" | "static" | "masked" | "other";

export interface Service {
  /** Nombre completo («caddy.service»; en OpenRC, «sshd»). */
  unit: string;
  /** Nombre corto para la tabla («caddy»). */
  name: string;
  state: RunState;
  /** Texto original (`active/running`, `failed`, `started`…). */
  raw: string;
  boot: BootState | null;
  /** Texto original de list-unit-files o de rc-update («enabled», «default»…). */
  bootRaw: string | null;
  description: string;
  /** `not-found`, `masked`, `bad-setting`… (solo systemd). */
  load: string | null;
}

/** Usuario de personas (uid ≥ 1000) y si tiene su gestor de servicios en marcha (/run/user/<uid>). */
export interface HumanUser {
  name: string;
  uid: number;
  home: string;
  runtimeDir: boolean;
}

const RUN: Record<string, RunState> = {
  active: "running",
  reloading: "running",
  failed: "failed",
  inactive: "stopped",
  activating: "starting",
  deactivating: "other",
};

const BOOT: Record<string, BootState> = {
  enabled: "enabled",
  "enabled-runtime": "enabled",
  alias: "other",
  indirect: "enabled",
  generated: "static",
  static: "static",
  transient: "static",
  disabled: "disabled",
  masked: "masked",
  "masked-runtime": "masked",
};

/** Quita el «●» o «*» que systemd pone delante de las unidades que faltan o fallan. */
function cleanTokens(line: string): string[] {
  const t = line.trim().split(/\s+/);
  while (t.length && /^[●*×○]$/.test(t[0])) t.shift();
  return t;
}

const shortName = (unit: string) => unit.replace(/\.service$/, "");

/** `systemctl list-units --type=service --all --no-legend --plain`: «UNIDAD LOAD ACTIVE SUB DESCRIPCIÓN». */
export function parseUnits(lines: string[]): Map<string, Omit<Service, "boot" | "bootRaw">> {
  const out = new Map<string, Omit<Service, "boot" | "bootRaw">>();
  for (const line of lines) {
    const t = cleanTokens(line);
    if (t.length < 4 || !t[0].endsWith(".service")) continue;
    const [unit, load, active, sub, ...desc] = t;
    out.set(unit, {
      unit,
      name: shortName(unit),
      state: RUN[active] ?? "other",
      raw: active === sub ? active : `${active}/${sub}`,
      description: desc.join(" "),
      load,
    });
  }
  return out;
}

/** `systemctl list-unit-files --type=service --no-legend`: «UNIDAD ESTADO [PRESET]». */
export function parseUnitFiles(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t.length >= 2 && t[0].endsWith(".service")) out.set(t[0], t[1]);
  }
  return out;
}

/**
 * Une las dos listas. Se quitan las plantillas («getty@.service»: no se arrancan tal cual) y lo que
 * systemd nombra pero no existe y está parado (`not-found` + inactivo: ruido de dependencias).
 */
export function mergeSystemd(unitLines: string[], fileLines: string[]): Service[] {
  const units = parseUnits(unitLines);
  const files = parseUnitFiles(fileLines);
  const out: Service[] = [];
  const bootOf = (unit: string) => {
    const raw = files.get(unit) ?? null;
    return { boot: raw ? (BOOT[raw] ?? "other") : null, bootRaw: raw };
  };
  for (const u of units.values()) {
    if (u.load === "not-found" && u.state !== "failed") continue;
    out.push({ ...u, ...bootOf(u.unit) });
  }
  for (const unit of files.keys()) {
    if (units.has(unit) || unit.includes("@.")) continue;
    const b = bootOf(unit);
    out.push({ unit, name: shortName(unit), state: "stopped", raw: "inactive", description: "", load: b.boot === "masked" ? "masked" : null, ...b });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Colores ANSI que rc-status pone si cree que hay terminal. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const RC_STATE: Record<string, RunState> = {
  started: "running",
  crashed: "failed",
  stopped: "stopped",
  starting: "starting",
  stopping: "other",
  inactive: "stopped",
};

/**
 * OpenRC: `rc-status --servicelist` (« sshd   [  started  ]», todos los servicios) y `rc-update show -v`
 * (« sshd |      default», vacío tras la barra si no arranca solo).
 */
export function parseOpenrc(statusLines: string[], updateLines: string[]): Service[] {
  const boot = new Map<string, string>();
  for (const line of updateLines) {
    const m = /^\s*(\S+)\s*\|\s*(.*)$/.exec(line);
    if (m) boot.set(m[1], m[2].trim());
  }
  const out: Service[] = [];
  for (const line of statusLines) {
    const m = /^\s*(\S+)\s+\[\s*([a-z]+)\s*\]/.exec(line.replace(ANSI, ""));
    if (!m) continue;
    const levels = boot.get(m[1]);
    out.push({
      unit: m[1],
      name: m[1],
      state: RC_STATE[m[2]] ?? "other",
      raw: m[2],
      boot: levels === undefined ? null : levels ? "enabled" : "disabled",
      bootRaw: levels ?? null,
      description: "",
      load: null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** «usuario|uid|home|1/0» (1 = tiene /run/user/<uid>). */
export function parseHumans(lines: string[]): HumanUser[] {
  const out: HumanUser[] = [];
  for (const line of lines) {
    const [name, uid, home, rt] = line.split("|");
    const n = Number(uid);
    if (name && Number.isInteger(n) && home?.startsWith("/")) out.push({ name, uid: n, home, runtimeDir: rt === "1" });
  }
  return out;
}

export interface ServicesRead {
  init: InitSystem;
  services: Service[];
  humans: HumanUser[];
  /** Usuario conectado. */
  me: string | null;
}

/** Salida de SERVICES_SCRIPT. */
export function parseServices(stdout: string): ServicesRead {
  const s = splitSections(stdout);
  const init = ((s.get("init") ?? [])[0] ?? "none") as InitSystem;
  const services =
    init === "systemd"
      ? mergeSystemd(s.get("units") ?? [], s.get("files") ?? [])
      : init === "openrc"
        ? parseOpenrc(s.get("rc") ?? [], s.get("rcboot") ?? [])
        : [];
  return { init, services, humans: parseHumans(s.get("humans") ?? []), me: (s.get("me") ?? [])[0]?.trim() || null };
}

/** Salida de los servicios `--user` de un usuario. Sin @@ok = su gestor no respondió. */
export function parseUserServices(stdout: string): Service[] | null {
  const s = splitSections(stdout);
  if (!s.has("ok")) return null;
  return mergeSystemd(s.get("units") ?? [], s.get("files") ?? []);
}

/** Cuántos hay en cada estado (para el filtro). */
export function countStates(list: Service[]): Record<RunState | "all", number> {
  const c: Record<RunState | "all", number> = { all: list.length, running: 0, failed: 0, stopped: 0, starting: 0, other: 0 };
  for (const x of list) c[x.state]++;
  return c;
}

/** Filtro de texto: nombre o descripción. */
export function matchService(x: Service, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || x.unit.toLowerCase().includes(q) || x.description.toLowerCase().includes(q);
}
