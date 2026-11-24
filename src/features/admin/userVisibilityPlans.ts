// Planes de arreglo para «Qué pueden ver tus usuarios» (Administración → Visibilidad).
// Todas las funciones son puras y devuelven `Plan` para enseñar los comandos exactos antes de ejecutarlos.
import { removeMemberStep, type AdminEnv, type Plan } from "./commands";
import { shQuote } from "./shell";
import { noTunnelsNonAdminSteps, noTunnelsSshdSteps } from "./sshdConf";
import type { UserVisibilityReport, VisibilityArea, VisibilityReport } from "./userVisibility";

const q = shQuote;

/** Quita túneles SSH a un usuario concreto con Match User + validación sshd -t. */
export function disableUserTunnelsPlan(user: string): Plan {
  return {
    action: `Desactivar túneles SSH para «${user}»`,
    danger: true,
    steps: noTunnelsSshdSteps(user),
  };
}

/** Quita túneles SSH a todos los usuarios sin sudo con un bloque Match global. */
export function disableAllNonAdminTunnelsPlan(adminGroups: string[]): Plan {
  return {
    action: "Desactivar túneles SSH para todos los usuarios sin sudo",
    danger: true,
    steps: noTunnelsNonAdminSteps(adminGroups),
  };
}

/** Activa hidepid=2 en /proc y lo deja en /etc/fstab para que sobreviva a reinicios. */
export function enableHidepidPlan(): Plan {
  return {
    action: "Ocultar procesos de otros usuarios (/proc hidepid=2)",
    danger: true,
    steps: [
      "# Ocultar procesos de otros usuarios inmediatamente y tras reiniciar",
      "mount -o remount,hidepid=2 /proc",
      "grep -qE '^proc[[:space:]]+/proc' /etc/fstab || echo 'proc /proc proc defaults,hidepid=2 0 0' >> /etc/fstab",
      "sed -i -E '/^proc[[:space:]]+\\/proc[[:space:]]/{/hidepid=/!s/^(proc[[:space:]]+\\/proc[[:space:]]+proc[[:space:]]+)([^[:space:]]+)/\\1\\2,hidepid=2/}' /etc/fstab",
    ],
  };
}

/** Cierra los permisos de carpetas HOME expuestas (700) y de configuración web en /etc. */
export function hardenFilesPlan(homes: string[], webDirs: string[], hasCaddyGroup: boolean): Plan | null {
  const steps: string[] = [];
  if (homes.length) {
    steps.push("# Cerrar carpetas HOME para que solo entre su dueño", `chmod 700 ${homes.map(q).join(" ")}`);
  }
  for (const d of webDirs) {
    if (d === "/etc/caddy") {
      if (hasCaddyGroup) steps.push("# Restringir /etc/caddy manteniendo acceso para el grupo caddy", "chgrp -R caddy /etc/caddy", "chmod -R g+rX,o-rwx /etc/caddy");
    } else {
      steps.push(`# Quitar lectura a otros usuarios en ${d}`, `chmod -R o-rwx ${q(d)}`);
    }
  }
  if (!steps.length) return null;
  return {
    action: homes.length && webDirs.length ? "Proteger carpetas HOME y configuración web" : homes.length ? "Cerrar permisos de carpetas HOME ajenas (700)" : "Restringir permisos de configuración web",
    danger: webDirs.length > 0,
    steps,
  };
}

/** Restringe logs y cron legibles por todos y opcionalmente quita al usuario de adm / systemd-journal. */
export function hardenCronLogsPlan(user: string, logGroups: string[], worldLogs: string[], worldCron: string[], env: AdminEnv | null): Plan | null {
  const steps: string[] = [];
  if (env) {
    for (const g of logGroups) {
      steps.push(`# Quitar a ${user} del grupo ${g} (lee logs del sistema)`, removeMemberStep(env, user, g));
    }
  }
  const files = [...worldLogs, ...worldCron];
  if (files.length) {
    steps.push("# Quitar permiso de lectura a otros usuarios en logs y cron", `chmod o-rwx ${files.map(q).join(" ")}`);
  }
  if (!steps.length) return null;
  return {
    action: `Restringir acceso a logs y cron para «${user}»`,
    steps,
  };
}

/** Quita acceso a Docker / sockets / carpetas de contenedores ajenas. */
export function hardenContainersPlan(
  user: string,
  inDockerGroup: boolean,
  dockerSock: VisibilityReport["dockerSock"],
  openRuntimeDirs: string[],
  env: AdminEnv | null,
): Plan | null {
  const steps: string[] = [];
  if (inDockerGroup && env) {
    steps.push(`# Quitar a ${user} del grupo docker (da acceso equivalente a root)`, removeMemberStep(env, user, "docker"));
  }
  if (dockerSock?.worldOpen) {
    steps.push(`# Cerrar permisos abiertos en ${dockerSock.path}`, `chmod 660 ${q(dockerSock.path)}`);
  }
  if (openRuntimeDirs.length) {
    steps.push("# Cerrar carpetas de contenedores de otros usuarios (700)", `chmod 700 ${openRuntimeDirs.map(q).join(" ")}`);
  }
  if (!steps.length) return null;
  return {
    action: `Restringir acceso a contenedores para «${user}»`,
    danger: inDockerGroup,
    steps,
  };
}

/** Devuelve el Plan concreto para arreglar un área de un usuario, o null si es solo manual. */
export function buildVisibilityFixPlan(area: VisibilityArea, u: UserVisibilityReport, report: VisibilityReport, env: AdminEnv | null): Plan | null {
  switch (area) {
    case "tunnels":
      return disableUserTunnelsPlan(u.user);
    case "processes":
      return enableHidepidPlan();
    case "files": {
      const touchedWeb = report.webDirs.filter((d) => report.webFiles.some((f) => f.startsWith(`${d}/`)));
      return hardenFilesPlan(u.exposedHomes, touchedWeb, report.hasCaddyGroup);
    }
    case "cronLogs":
      return hardenCronLogsPlan(u.user, u.logGroups, report.worldLogs, report.worldCron, env);
    case "containers": {
      const otherRun = report.openRuntimeDirs.filter((d) => !d.endsWith(`-${u.uid}`) && !d.endsWith(`/${u.uid}`));
      return hardenContainersPlan(u.user, u.inDockerGroup, report.dockerSock, otherRun, env);
    }
    case "localServices":
    default:
      return null;
  }
}
