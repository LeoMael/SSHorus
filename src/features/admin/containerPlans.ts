// Dar o quitar permiso para usar contenedores (Podman sin root, grupo docker, linger). Funciones puras.
import { addMemberStep, removeMemberStep, type AdminEnv, type Plan } from "./commands";
import { rangeText, type ContainerAccessInfo, type SubidRange, type UserContainers } from "./containerAccess";
import { shQuote as q } from "../../lib/remote";

export interface PodmanTarget {
  name: string;
  home: string;
}

/**
 * Como el usuario, `podman system migrate` para que su podman use los rangos nuevos (detiene sus
 * contenedores encendidos). Solo si ya usó podman: así no se le crea nada en su carpeta. No es fatal:
 * el cambio de rangos ya está hecho.
 */
export function podmanMigrateStep(u: PodmanTarget): string {
  const store = `${u.home.replace(/\/+$/, "")}/.local/share/containers`;
  const run = `if command -v runuser >/dev/null 2>&1; then runuser -u ${q(u.name)} -- env -u XDG_RUNTIME_DIR podman system migrate; else su -s /bin/sh -c 'podman system migrate' ${q(u.name)}; fi`;
  const warn = `echo ${q(`Aviso: no se pudo ejecutar «podman system migrate» como ${u.name}; se aplicará cuando vuelva a entrar`)} >&2`;
  return `if [ -d ${q(store)} ]; then cd / && { ${run} || ${warn}; }; fi`;
}

function lingerStep(name: string, on: boolean): string {
  return `loginctl ${on ? "enable" : "disable"}-linger ${q(name)}`;
}

/** Añade los rangos que le falten (el mismo rango libre para subuid y subgid). */
export function grantPodmanPlan(
  u: PodmanTarget,
  cur: Pick<UserContainers, "subuid" | "subgid" | "linger">,
  range: { start: number; count: number },
  linger: boolean,
): Plan {
  const r = rangeText(range);
  const add = [
    ...(cur.subuid.length ? [] : [`--add-subuids ${r}`]),
    ...(cur.subgid.length ? [] : [`--add-subgids ${r}`]),
  ];
  return {
    action: `Dar Podman sin root a «${u.name}»`,
    steps: [
      ...(add.length ? [`# ${range.count} identificadores libres (no se solapan con /etc/subuid ni /etc/subgid)`, `usermod ${add.join(" ")} ${q(u.name)}`] : []),
      podmanMigrateStep(u),
      ...(linger && cur.linger === false ? [lingerStep(u.name, true)] : []),
    ],
  };
}

const delFlags = (flag: string, ranges: readonly SubidRange[]) => ranges.map((r) => `${flag} ${rangeText(r)}`);

/** Quita todos sus rangos. Sus contenedores e imágenes se quedan en su carpeta. */
export function revokePodmanPlan(u: PodmanTarget, cur: Pick<UserContainers, "subuid" | "subgid" | "linger">, disableLinger: boolean): Plan {
  const del = [...delFlags("--del-subuids", cur.subuid), ...delFlags("--del-subgids", cur.subgid)];
  return {
    action: `Quitar Podman sin root a «${u.name}»`,
    steps: [
      ...(del.length ? [`usermod ${del.join(" ")} ${q(u.name)}`] : []),
      podmanMigrateStep(u),
      ...(disableLinger && cur.linger ? [lingerStep(u.name, false)] : []),
    ],
  };
}

export function lingerPlan(name: string, on: boolean): Plan {
  return {
    action: `${on ? "Activar" : "Desactivar"} linger de «${name}»`,
    steps: [lingerStep(name, on)],
  };
}

/** Grupo docker: equivale a root, por eso se marca como cambio peligroso. */
export function grantDockerPlan(env: AdminEnv, name: string): Plan {
  return {
    action: `Añadir «${name}» al grupo docker`,
    steps: ["# Estar en el grupo docker equivale a ser root del servidor", addMemberStep(env, name, "docker")],
    danger: true,
  };
}

export function revokeDockerPlan(env: AdminEnv, name: string): Plan {
  return {
    action: `Quitar a «${name}» del grupo docker`,
    steps: [removeMemberStep(env, name, "docker")],
  };
}

// ───────── Qué se puede hacer con cada usuario ─────────

export type ContainerAction = "podman-grant" | "podman-revoke" | "linger-on" | "docker-grant" | "docker-revoke";

interface ActionCtx {
  info: Pick<ContainerAccessInfo, "podman" | "subidUsermod" | "dockerGroup">;
  user: UserContainers;
  uid: number;
}

const ACTION_RULES: Record<ContainerAction, (c: ActionCtx) => boolean> = {
  "podman-grant": (c) => c.info.podman && c.info.subidUsermod && c.uid !== 0 && c.user.podman !== "yes",
  "podman-revoke": (c) => c.info.subidUsermod && c.user.subuid.length + c.user.subgid.length > 0,
  "linger-on": (c) => c.info.podman && c.user.podman === "yes" && c.user.linger === false,
  "docker-grant": (c) => c.info.dockerGroup && c.uid !== 0 && !c.user.dockerGroup,
  "docker-revoke": (c) => c.user.dockerGroup,
};

export function containerActions(c: ActionCtx): ContainerAction[] {
  return (Object.keys(ACTION_RULES) as ContainerAction[]).filter((a) => ACTION_RULES[a](c));
}
