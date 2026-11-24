// ¿Arranca solo un contenedor tras reiniciar el servidor o si se cae? Lectura (un script por dueño)
// y decisión. Funciones puras.
//
// - Docker: política de reinicio (always, unless-stopped, on-failure) + docker.service habilitado.
// - Podman: nadie vigila los contenedores; al encender, `podman-restart.service` arranca los de política
//   «always» (y «unless-stopped» desde Podman 5.8.2). O los arranca su unidad de systemd (Quadlet o
//   `podman generate systemd`), que deja la etiqueta PODMAN_SYSTEMD_UNIT en el contenedor.
// - Sin root (Podman rootless o Docker rootless): los servicios son de usuario y solo arrancan con el
//   servidor si el usuario tiene linger.
import { splitMarked } from "./parse";
import { q } from "./shell";
import { OWNER_ROOT, OWNER_SELF, ownerKey, type CtOwner } from "./owner";
import type { Engine } from "./types";

/** Servicio que arranca los contenedores al encender. */
export const AUTOSTART_SERVICE: Record<Engine, string> = {
  podman: "podman-restart.service",
  docker: "docker.service",
};

/** Cómo se leen y se cambian los datos de arranque de un dueño. */
export interface AutostartScope {
  engine: Engine;
  /** Sin root (Podman rootless o Docker rootless): servicios de usuario y linger. */
  userMode: boolean;
  /** Docker rootless de otro usuario: sus comandos van como root (con DOCKER_HOST), así que systemctl
   * apunta a su gestor con `--user -M usuario@` y loginctl a su nombre. */
  machineUser?: string;
}

/** Dueño en el que se apoya cada cosa de su arranque. */
export interface AutostartOwner {
  key: string;
  scope: AutostartScope;
  /** Dueño (clave) que ejecuta como root (systemctl del sistema); null = no hay forma desde aquí. */
  rootKey: string | null;
  /** `loginctl enable-linger`: con qué dueño y para qué usuario (null = el propio, sin argumento). */
  linger: { owner: string; user: string | null } | null;
}

/** Datos de un dueño para decidir. `owner.isRoot`: la conexión ya es root; `selfSudo`: Docker con sudo. */
export function autostartOwner(o: CtOwner, ctx: { engine: Engine; isRoot: boolean; rootless: boolean; selfSudo: boolean }): AutostartOwner {
  const key = ownerKey(o);
  if (ctx.engine === "podman") {
    const rootKey = ctx.isRoot ? OWNER_SELF : OWNER_ROOT;
    if (o.kind === "root" || (o.kind === "self" && ctx.isRoot)) return { key, scope: { engine: "podman", userMode: false }, rootKey, linger: null };
    if (o.kind === "self") return { key, scope: { engine: "podman", userMode: true }, rootKey, linger: { owner: key, user: null } };
    return { key, scope: { engine: "podman", userMode: true }, rootKey, linger: { owner: rootKey, user: o.user.name } };
  }
  if (o.kind === "user") {
    return { key, scope: { engine: "docker", userMode: true, machineUser: o.user.name }, rootKey: key, linger: { owner: key, user: o.user.name } };
  }
  if (ctx.rootless && !ctx.isRoot) return { key, scope: { engine: "docker", userMode: true }, rootKey: null, linger: { owner: key, user: null } };
  return { key, scope: { engine: "docker", userMode: false }, rootKey: ctx.isRoot || ctx.selfSudo ? key : null, linger: null };
}

/** `systemctl` con el gestor que toca (sistema, el del usuario o el de otro usuario). */
export function systemctlArgs(s: AutostartScope): string[] {
  if (!s.userMode) return [];
  return s.machineUser ? ["--user", "-M", `${s.machineUser}@`] : ["--user"];
}

/**
 * Lee, como el dueño: política de reinicio y unidad de systemd de cada contenedor (`inspect` en lote),
 * si el servicio de arranque está habilitado, el estado de esas unidades y (sin root) el linger.
 */
export function autostartScript(s: AutostartScope): string {
  const e = s.engine;
  const sc = systemctlArgs(s).join(" ");
  const svc = AUTOSTART_SERVICE[e];
  const unitField = e === "podman" ? '{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}' : "";
  const lines = [
    "set -f",
    "echo @@tv:inspect",
    `ids=$(${e} ps -aq --no-trunc 2>/dev/null)`,
    `out=; if [ -n "$ids" ]; then out=$(${e} inspect --format '{{.Id}}|{{.HostConfig.RestartPolicy.Name}}|${unitField}' $ids 2>/dev/null); fi`,
    'printf "%s\\n" "$out"',
    "echo @@tv:service",
    `s=$(systemctl ${sc} is-enabled ${svc} 2>/dev/null)`,
    // Sin gestor de usuario en marcha (sin sesión ni linger) systemctl --user no responde: se mira el enlace.
    ...(s.userMode && !s.machineUser ? [`if [ -z "$s" ] && [ -e "$HOME/.config/systemd/user/default.target.wants/${svc}" ]; then s=enabled; fi`] : []),
    'echo "$s"',
    "echo @@tv:units",
    `units=$(printf '%s\\n' "$out" | cut -d'|' -f3 | grep -E '^[A-Za-z0-9@_.:-]+$' | sort -u)`,
    `if [ -n "$units" ]; then systemctl ${sc} show -p Id -p LoadState -p UnitFileState -p WantedBy -p RequiredBy $units 2>/dev/null; fi`,
  ];
  if (s.userMode) {
    lines.push(
      // Si un contenedor sin root lo arranca un servicio del sistema (p. ej. podman-compose@.service con User=),
      // `systemctl --user` dirá LoadState=not-found: miramos también el gestor del sistema (solo lectura, sin sudo).
      "echo @@tv:sysunits",
      'if [ -n "$units" ]; then systemctl show -p Id -p LoadState -p UnitFileState -p WantedBy -p RequiredBy $units 2>/dev/null; fi',
      "echo @@tv:linger",
      `u=${s.machineUser ? q(s.machineUser) : '"$(id -un)"'}`,
      'if [ -e "/var/lib/systemd/linger/$u" ]; then echo yes',
      "elif command -v loginctl >/dev/null 2>&1; then l=$(loginctl show-user \"$u\" -p Linger 2>/dev/null | sed -n 's/^Linger=//p'); echo \"${l:-no}\"",
      "else echo '?'; fi",
    );
  }
  lines.push("echo @@tv:end");
  return lines.join("\n");
}

export interface UnitInfo {
  /** Estado de carga (loaded, not-found…). */
  loadState: string;
  /** Estado del archivo de la unidad (enabled, disabled, generated, indirect, static…). */
  fileState: string;
  /** Algún objetivo la arranca (WantedBy/RequiredBy) o está habilitada. */
  wanted: boolean;
  /** Pertenece al gestor del sistema (`systemctl`), no al del usuario (`--user`). */
  system: boolean;
}

export interface OwnerAutostart {
  /** Por id completo: política de reinicio y unidad de systemd que lo gestiona. */
  policies: Map<string, { policy: string; unit: string | null }>;
  /** Salida de `systemctl is-enabled` del servicio de arranque (null = no se pudo saber). */
  service: string | null;
  units: Map<string, UnitInfo>;
  /** Linger del usuario (null = no aplica o no se sabe). */
  linger: boolean | null;
}

const ENABLED = new Set(["enabled", "enabled-runtime"]);
/** Estados de archivo que `systemctl enable/disable` puede cambiar (excluye Quadlet `generated`, `static`, `transient`, `masked`). */
const TOGGLEABLE_UNIT = new Set(["disabled", "indirect", "enabled", "enabled-runtime", "linked", "linked-runtime"]);

export function canToggleUnit(u: UnitInfo | null | undefined): boolean {
  return !!u && u.loadState !== "not-found" && TOGGLEABLE_UNIT.has(u.fileState);
}

function parseUnits(text: string, system: boolean): Map<string, UnitInfo> {
  const out = new Map<string, UnitInfo>();
  for (const block of text.split(/\n\s*\n/)) {
    const kv = new Map<string, string>();
    for (const line of block.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
    const id = kv.get("Id");
    if (!id) continue;
    const loadState = kv.get("LoadState") ?? "";
    const fileState = kv.get("UnitFileState") ?? "";
    out.set(id, {
      loadState,
      fileState,
      wanted: loadState !== "not-found" && (ENABLED.has(fileState) || !!kv.get("WantedBy") || !!kv.get("RequiredBy")),
      system,
    });
  }
  return out;
}

export function parseAutostart(stdout: string): OwnerAutostart {
  const s = splitMarked(stdout);
  const policies = new Map<string, { policy: string; unit: string | null }>();
  for (const line of (s.get("inspect") ?? "").split("\n")) {
    const [id, policy, unit] = line.trim().split("|");
    if (!id || !/^[0-9a-f]{12,}$/i.test(id)) continue;
    policies.set(id, { policy: (policy ?? "").trim() || "no", unit: unit?.trim() || null });
  }
  const service = (s.get("service") ?? "").trim().split("\n")[0].trim() || null;
  const l = (s.get("linger") ?? "").trim();
  const hasSys = s.has("sysunits");
  const units = parseUnits(s.get("units") ?? "", !hasSys);
  if (hasSys) {
    for (const [id, sys] of parseUnits(s.get("sysunits") ?? "", true)) {
      const cur = units.get(id);
      if ((!cur || cur.loadState === "not-found") && sys.loadState !== "not-found") units.set(id, sys);
    }
  }
  return { policies, service, units, linger: l === "yes" ? true : l === "no" ? false : null };
}

// ───────── Decisión ─────────

/** Versión «a.b.c» mayor o igual que `min` (sin versión, se supone que sí). */
export function versionAtLeast(v: string | null, min: [number, number, number]): boolean {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v ?? "");
  if (!m) return true;
  const got = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  for (let i = 0; i < 3; i++) if (got[i] !== min[i]) return got[i] > min[i];
  return true;
}

/** Podman arranca los «unless-stopped» al encender desde 5.8.2 (antes solo los «always»). */
const podmanBootsUnlessStopped = (v: string | null) => versionAtLeast(v, [5, 8, 2]);

/** Política que se pone para que arranque solo. */
export function autostartPolicy(engine: Engine, version: string | null): string {
  return engine === "docker" || podmanBootsUnlessStopped(version) ? "unless-stopped" : "always";
}

/** `podman update --restart` existe desde Podman 5.1; `docker update`, siempre. */
export function canUpdateRestart(engine: Engine, version: string | null): boolean {
  return engine === "docker" || versionAtLeast(version, [5, 1, 0]);
}

export type AutostartVerdict = "yes" | "no" | "unknown";
export type AutostartMissing = "policy" | "service" | "linger" | "unit";

export interface AutostartInfo {
  verdict: AutostartVerdict;
  policy: string;
  /** Unidad de systemd que lo gestiona (Quadlet, podman-compose@.service…): su política de reinicio no se toca. */
  unit: string | null;
  /** Datos de la unidad de systemd si se pudieron leer. */
  unitInfo?: UnitInfo | null;
  /** Explicación para el tooltip (una idea por línea). */
  why: string[];
  /** Qué falta para que arranque solo. */
  missing: AutostartMissing[];
}

const POLICY_TEXT: Record<string, string> = {
  no: "no se vuelve a arrancar si se cae",
  always: "se vuelve a arrancar si se cae",
  "unless-stopped": "se vuelve a arrancar si se cae, salvo que lo pares tú",
  "on-failure": "se vuelve a arrancar si se cae con un error",
};

function policyOk(engine: Engine, policy: string, version: string | null): boolean {
  if (engine === "docker") return policy === "always" || policy === "unless-stopped" || policy === "on-failure";
  return policy === "always" || (policy === "unless-stopped" && podmanBootsUnlessStopped(version));
}

function lingerLine(linger: boolean | null): string {
  if (linger === true) return "El usuario tiene linger: sus servicios arrancan con el servidor sin iniciar sesión.";
  if (linger === false) return "El usuario no tiene linger: sin una sesión abierta no arranca nada suyo.";
  return "No se pudo saber si el usuario tiene linger.";
}

function serviceLine(scope: AutostartScope, state: string | null): string {
  const svc = AUTOSTART_SERVICE[scope.engine];
  const what = scope.engine === "docker" ? `El servicio de Docker (${svc}${scope.userMode ? " de usuario" : ""})` : `${svc} ${scope.userMode ? "de usuario" : "del sistema"}`;
  if (state === null) return `No se pudo saber si ${what} está habilitado.`;
  if (ENABLED.has(state)) return `${what} está habilitado: arranca con el servidor.`;
  return scope.engine === "docker"
    ? `${what} no está habilitado: Docker no arranca con el servidor.`
    : `${what} no está habilitado: nadie arranca los contenedores al encender.`;
}

function verdictOf(parts: (boolean | null)[]): AutostartVerdict {
  if (parts.some((p) => p === false)) return "no";
  return parts.some((p) => p === null) ? "unknown" : "yes";
}

/** ¿Arranca solo el contenedor `id`? null si no está en los datos leídos. */
export function decideAutostart(id: string, f: OwnerAutostart, scope: AutostartScope, version: string | null): AutostartInfo | null {
  const p = f.policies.get(id) ?? [...f.policies.entries()].find(([k]) => k.startsWith(id) || id.startsWith(k))?.[1];
  if (!p) return null;
  const linger = scope.userMode ? f.linger : true;
  const lingerOk = linger;
  const lingerMissing: AutostartMissing[] = scope.userMode && f.linger === false ? ["linger"] : [];

  if (p.unit) {
    const u = f.units.get(p.unit) ?? null;
    const found = u && u.loadState !== "not-found" ? u : null;
    const wanted = found ? found.wanted : null;
    const needsLinger = scope.userMode && !found?.system;
    const unitLinger = needsLinger ? f.linger : true;
    const unitLingerMissing: AutostartMissing[] = needsLinger && f.linger === false ? ["linger"] : [];
    const why = [`Lo gestiona el servicio «${p.unit}» (systemd${found?.system ? " del sistema" : scope.userMode ? " de usuario" : ""}).`];
    if (wanted === true) {
      why.push("El servicio está habilitado: arranca con el servidor.");
    } else if (wanted === false) {
      why.push(
        found?.fileState === "generated"
          ? "El servicio (Quadlet) no está habilitado para arrancar con el servidor (falta «WantedBy=default.target» en su archivo .container)."
          : "El servicio no está habilitado: no arranca al reiniciar el servidor.",
      );
    } else {
      why.push("No se pudo comprobar si el servicio está habilitado.");
    }
    if (needsLinger) why.push(lingerLine(f.linger));
    const missing: AutostartMissing[] = [...(wanted === false && canToggleUnit(found) ? (["unit"] as const) : []), ...unitLingerMissing];
    return { verdict: verdictOf([wanted, unitLinger]), policy: p.policy, unit: p.unit, unitInfo: found, why, missing };
  }

  const pOk = policyOk(scope.engine, p.policy, version);
  const svcOk = f.service === null ? null : ENABLED.has(f.service);
  const why = [`Política de reinicio «${p.policy}»: ${POLICY_TEXT[p.policy] ?? "desconocida"}.`];
  if (scope.engine === "podman" && p.policy === "on-failure") why.push("Con «on-failure», Podman no lo arranca al reiniciar el servidor.");
  if (scope.engine === "podman" && p.policy === "unless-stopped" && !pOk) {
    why.push("Este Podman (antes de 5.8.2) no arranca los «unless-stopped» al reiniciar el servidor: hace falta «always».");
  }
  why.push(serviceLine(scope, f.service));
  if (scope.userMode) why.push(lingerLine(f.linger));
  const missing: AutostartMissing[] = [...(pOk ? [] : (["policy"] as const)), ...(svcOk === true ? [] : (["service"] as const)), ...lingerMissing];
  return { verdict: verdictOf([pOk, svcOk, lingerOk]), policy: p.policy, unit: null, why, missing };
}
