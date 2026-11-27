// Cambios de un servicio (arrancar, parar, reiniciar, activar o desactivar al encender, desbloquear),
// descritos en una tabla y listos para el diálogo de cambios de Administración (comando exacto, como root
// y como tarea). Nunca para ni desactiva SSH sin aviso fuerte. Funciones puras.
import { shQuote } from "../../lib/remote";
import type { ConfigChange } from "../serverConfig";
import type { HumanUser, InitSystem, Service } from "./parse";
import { asUserLine, validUnit } from "./script";

export type ServiceAction = "start" | "stop" | "restart" | "enable" | "disable" | "unmask";

interface ActionRow {
  label: string;
  /** Verbo para el título («Arrancar caddy»). */
  verb: string;
  explain: string;
  systemd: string[];
  /** OpenRC (null = no existe ahí). */
  openrc: ((s: string) => string) | null;
  /** Corta el servicio: si es SSH te quedas fuera. */
  cuts: boolean;
}

export const SERVICE_ACTIONS: Record<ServiceAction, ActionRow> = {
  start: { label: "Arrancar", verb: "Arrancar", explain: "Lo pone en marcha ahora.", systemd: ["start"], openrc: (s) => `rc-service ${s} start`, cuts: false },
  stop: { label: "Parar", verb: "Parar", explain: "Lo detiene ahora (vuelve a arrancar al encender si está activado).", systemd: ["stop"], openrc: (s) => `rc-service ${s} stop`, cuts: true },
  restart: { label: "Reiniciar", verb: "Reiniciar", explain: "Lo para y lo vuelve a arrancar (p. ej. para que lea su configuración).", systemd: ["restart"], openrc: (s) => `rc-service ${s} restart`, cuts: false },
  enable: { label: "Activar al encender", verb: "Activar al encender", explain: "Arrancará solo cada vez que se encienda el servidor (no lo arranca ahora).", systemd: ["enable"], openrc: (s) => `rc-update add ${s} default`, cuts: false },
  disable: { label: "Desactivar al encender", verb: "Desactivar al encender", explain: "Dejará de arrancar solo al encender el servidor (no lo para ahora).", systemd: ["disable"], openrc: (s) => `rc-update del ${s} default`, cuts: true },
  unmask: { label: "Desbloquear", verb: "Desbloquear", explain: "Quita el bloqueo («masked») que impide arrancarlo, a mano o al encender.", systemd: ["unmask"], openrc: null, cuts: false },
};

/** El servicio de SSH: pararlo o desactivarlo te deja fuera del servidor. */
export function isSshService(unit: string): boolean {
  return /^(sshd?|openssh(-server)?|dropbear)(@[^.]*)?(\.service|\.socket)?$/.test(unit);
}

/** Piezas del sistema que no conviene parar (red, bus, registro, sesiones). */
const CRITICAL_RE = /^(dbus(-broker)?|systemd-[a-z-]+|NetworkManager|networking|network|wpa_supplicant|polkit)(\.service)?$/;

export function isCriticalService(unit: string): boolean {
  return CRITICAL_RE.test(unit);
}

/** Acciones que tienen sentido para el servicio en su estado actual (en el orden de los botones). */
export function actionsFor(s: Service, init: InitSystem, user: HumanUser | null): ServiceAction[] {
  if (init === "none" || (init === "openrc" && user)) return [];
  const out: ServiceAction[] = [];
  if (s.boot === "masked") return init === "systemd" ? ["unmask"] : [];
  if (s.state === "running" || s.state === "starting") out.push("stop", "restart");
  else out.push("start");
  if (s.state === "failed") out.push("restart");
  if (s.boot === "enabled") out.push("disable");
  else if (s.boot === "disabled") out.push("enable");
  return out;
}

export interface ServiceChangeCtx {
  init: "systemd" | "openrc";
  /** Servicio `--user` de este usuario (null = del sistema). */
  user: HumanUser | null;
  /** El servidor tiene `runuser` (casi siempre; si no, `su`). */
  runuser?: boolean;
}

const ID_SAFE = (s: string) => s.replace(/[^A-Za-z0-9_.@-]/g, "_");

/** El cambio listo para revisar y ejecutar como root (null si el nombre no es válido). */
export function serviceChange(s: Service, action: ServiceAction, c: ServiceChangeCtx): ConfigChange | null {
  const row = SERVICE_ACTIONS[action];
  if (!validUnit(s.unit, c.init) || (c.init === "openrc" && !row.openrc) || (c.user && c.init !== "systemd")) return null;
  const steps: string[] = [];
  const ssh = !c.user && isSshService(s.unit);
  // Antes de reiniciar SSH se comprueba su configuración: si está rota, no se reinicia (no te quedas fuera).
  if (ssh && action === "restart" && !s.unit.startsWith("dropbear")) steps.push("# Comprobar la configuración de SSH antes de reiniciarlo", 'PATH="$PATH:/usr/sbin:/sbin" sshd -t');
  if (c.init === "openrc") steps.push(row.openrc!(shQuote(s.unit)));
  else if (c.user) steps.push(asUserLine(c.user, "systemctl", ["--user", ...row.systemd, s.unit], c.runuser ?? true));
  else steps.push(`systemctl ${row.systemd.join(" ")} ${shQuote(s.unit)}`);

  const who = c.user ? ` (de ${c.user.name})` : "";
  let note: string | null = null;
  let danger = false;
  if (ssh && row.cuts) {
    danger = true;
    note =
      action === "stop"
        ? "Es el servicio de SSH: si lo paras, nadie podrá volver a entrar (tampoco SSHorus) hasta que alguien lo arranque desde la consola del proveedor. Tu conexión actual puede seguir abierta un rato, pero no cuentes con ello."
        : "Es el servicio de SSH: si no arranca al encender, tras el próximo reinicio no podrás entrar. Hazlo solo si tienes otra forma de acceso (consola del proveedor).";
  } else if (!c.user && isCriticalService(s.unit) && row.cuts) {
    danger = true;
    note = "Es una pieza del sistema: pararla o desactivarla puede dejar el servidor sin red, sin registro o inestable.";
  } else if (ssh && action === "restart" && !s.unit.startsWith("dropbear")) {
    note = "Primero se comprueba la configuración (sshd -t). Las conexiones abiertas siguen.";
  }
  return {
    id: `svc:${c.user ? `${c.user.name}:` : ""}${ID_SAFE(s.unit)}:${action}`,
    label: row.label,
    title: `${row.verb} ${s.name}${who}`,
    explain: row.explain,
    steps,
    danger,
    note,
    guardCheck: null,
    timeoutSecs: 120,
  };
}

/**
 * `loginctl enable-linger`: el gestor de servicios del usuario arranca al encender y sigue sin sesión
 * abierta (sin él, sus servicios `--user` y sus contenedores se paran al salir).
 */
export function lingerChange(user: HumanUser): ConfigChange | null {
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,31}$/.test(user.name)) return null;
  return {
    id: `svc:linger:${user.name}`,
    label: "Activar linger",
    title: `Mantener en marcha los servicios de ${user.name}`,
    explain: `Activa «linger» para ${user.name}: su gestor de servicios arranca al encender el servidor y sigue aunque no tenga ninguna sesión abierta.`,
    steps: [`loginctl enable-linger ${shQuote(user.name)}`],
    danger: false,
    note: null,
    guardCheck: null,
    timeoutSecs: 60,
  };
}
