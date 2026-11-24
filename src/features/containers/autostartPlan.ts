// Comandos para que unos contenedores arranquen solos (o dejen de hacerlo). Funciones puras.
// Cada comando lleva su dueño: el linger de otro usuario y el systemctl del sistema van como root;
// la política y los servicios de usuario, como el dueño del contenedor.
import {
  AUTOSTART_SERVICE,
  autostartPolicy,
  canToggleUnit,
  canUpdateRestart,
  systemctlArgs,
  type AutostartInfo,
  type AutostartOwner,
  type OwnerAutostart,
  type UnitInfo,
} from "./autostart";
import { splitByOwner } from "./owner";
import { engineCmd, type Cmd } from "./shell";
import type { Engine } from "./types";

export interface AutostartTarget {
  id: string;
  name: string;
  owner: string;
  info: AutostartInfo;
}

export interface AutostartPlan {
  cmds: Cmd[];
  /** Lo que no se puede hacer desde aquí (o se hace aparte), en palabras simples. */
  notes: string[];
}

export interface PlanCtx {
  engine: Engine;
  version: string | null;
  owner: (key: string) => AutostartOwner | null;
  facts: (key: string) => OwnerAutostart | null;
}

/** `update --restart`: Docker admite varios contenedores a la vez; Podman, uno por comando. */
function updateCmds(engine: Engine, policy: string, ts: AutostartTarget[], owner: string): Cmd[] {
  const refs = ts.map((t) => t.name || t.id);
  const groups = engine === "docker" ? [refs] : refs.map((r) => [r]);
  return groups.map((g) => ({ ...engineCmd(engine, "update", "--restart", policy, ...g), owner }));
}

const quoted = (ts: AutostartTarget[]) => ts.map((t) => `«${t.name}»`).join(", ");

function cantUpdateNote(ctx: PlanCtx, ts: AutostartTarget[], policy: string): string {
  return (
    `Podman ${ctx.version ?? ""} no puede cambiar la política de un contenedor ya creado (hace falta 5.1 o más): ` +
    `hay que volver a crear ${quoted(ts)} con «--restart ${policy}».`
  );
}

/** Agrupa los contenedores que comparten una misma unidad de systemd (p. ej. un proyecto Compose). */
function groupByUnit(ts: AutostartTarget[]): Map<string, AutostartTarget[]> {
  const map = new Map<string, AutostartTarget[]>();
  for (const t of ts) {
    if (!t.info.unit) continue;
    const list = map.get(t.info.unit) ?? [];
    list.push(t);
    map.set(t.info.unit, list);
  }
  return map;
}

/** Comando `systemctl enable/disable <unit>` en el gestor (usuario o sistema) que corresponda. */
function unitToggleCmd(
  action: "enable" | "disable",
  unit: string,
  u: UnitInfo,
  o: AutostartOwner,
  key: string,
  offline: boolean,
): { cmd: Cmd | null; note?: string } {
  if (u.system) {
    if (!o.rootKey) {
      return {
        cmd: null,
        note: `«${unit}» es un servicio del sistema y hace falta root para cambiarlo: «sudo systemctl ${action} ${unit}».`,
      };
    }
    return { cmd: { bin: ["systemctl"], args: [action, unit], owner: o.rootKey } };
  }
  return {
    cmd: {
      bin: offline ? ["env", "SYSTEMCTL_INSTALL_CLIENT_SIDE=1", "systemctl"] : ["systemctl"],
      args: [...systemctlArgs(o.scope), action, unit],
      owner: key,
    },
  };
}

function enablePlan(ctx: PlanCtx, key: string, ts: AutostartTarget[], out: AutostartPlan) {
  const o = ctx.owner(key);
  if (!o) {
    out.notes.push(`No se encontró el usuario dueño de ${quoted(ts)}.`);
    return;
  }
  const f = ctx.facts(key);
  const missing = new Set(ts.flatMap((t) => t.info.missing));
  const svc = AUTOSTART_SERVICE[ctx.engine];
  const offline = o.scope.userMode && !o.scope.machineUser && (f?.service === null || missing.has("linger"));

  if (missing.has("linger") && o.linger) {
    out.cmds.push({ bin: ["loginctl"], args: ["enable-linger", ...(o.linger.user ? [o.linger.user] : [])], owner: o.linger.owner });
  }

  for (const [unit, group] of groupByUnit(ts)) {
    const u = group[0].info.unitInfo ?? f?.units.get(unit) ?? null;
    if (u && !u.wanted && canToggleUnit(u)) {
      const r = unitToggleCmd("enable", unit, u, o, key, offline);
      if (r.cmd) out.cmds.push(r.cmd);
      else if (r.note) out.notes.push(r.note);
    } else if (!u || !u.wanted) {
      const why =
        u?.fileState === "generated"
          ? "es un servicio Quadlet (añade «WantedBy=default.target» en la sección [Install] de su archivo .container)."
          : u?.fileState === "static"
            ? "es un servicio static sin sección [Install] (no se habilita con systemctl)."
            : "su servicio no se puede habilitar directamente con systemctl desde aquí.";
      out.notes.push(`${quoted(group)} depende de «${unit}»: ${why}`);
    }
  }

  const policy = autostartPolicy(ctx.engine, ctx.version);
  const needPolicy = ts.filter((t) => !t.info.unit && t.info.missing.includes("policy"));
  if (needPolicy.length) {
    if (canUpdateRestart(ctx.engine, ctx.version)) out.cmds.push(...updateCmds(ctx.engine, policy, needPolicy, key));
    else out.notes.push(cantUpdateNote(ctx, needPolicy, policy));
  }

  if (missing.has("service") && ts.some((t) => !t.info.unit)) {
    const runAs = o.scope.userMode ? key : o.rootKey;
    if (!runAs) {
      out.notes.push(`${svc} no está habilitado y hace falta root para hacerlo: «sudo systemctl enable ${svc}».`);
    } else {
      // Sin gestor de usuario en marcha (sin sesión ni linger), systemctl --user no responde: se habilita
      // directamente en sus archivos.
      out.cmds.push({
        bin: offline ? ["env", "SYSTEMCTL_INSTALL_CLIENT_SIDE=1", "systemctl"] : ["systemctl"],
        args: [...systemctlArgs(o.scope), "enable", svc],
        owner: runAs,
      });
    }
  }
}

function disablePlan(ctx: PlanCtx, key: string, ts: AutostartTarget[], out: AutostartPlan) {
  const o = ctx.owner(key);
  const f = ctx.facts(key);
  const offline = !!o && o.scope.userMode && !o.scope.machineUser && f?.service === null;

  for (const [unit, group] of groupByUnit(ts)) {
    const u = group[0].info.unitInfo ?? f?.units.get(unit) ?? null;
    if (o && u && u.wanted && canToggleUnit(u)) {
      const r = unitToggleCmd("disable", unit, u, o, key, offline);
      if (r.cmd) out.cmds.push(r.cmd);
      else if (r.note) out.notes.push(r.note);
    } else {
      out.notes.push(
        `${quoted(group)} lo arranca su servicio «${unit}»: para que no arranque solo, deshabilita ese servicio ` +
          "(o, si es de Quadlet, quita «WantedBy=» de la sección [Install] de su archivo .container).",
      );
    }
  }
  const ts2 = ts.filter((x) => !x.info.unit && x.info.policy !== "no");
  if (!ts2.length) return;
  if (canUpdateRestart(ctx.engine, ctx.version)) out.cmds.push(...updateCmds(ctx.engine, "no", ts2, key));
  else out.notes.push(cantUpdateNote(ctx, ts2, "no"));
}

/** Plan para encender (`on`) o apagar el arranque solo de unos contenedores, por dueño. */
export function autostartPlan(on: boolean, targets: AutostartTarget[], ctx: PlanCtx): AutostartPlan {
  const out: AutostartPlan = { cmds: [], notes: [] };
  for (const [key, ts] of splitByOwner(targets, "")) (on ? enablePlan : disablePlan)(ctx, key, ts, out);
  return out;
}
