// «Cerrar puerto»: los comandos para parar lo que escucha (servicio de systemd, programa o contenedor),
// cada uno con el usuario que hace falta. Funciones puras.
import type { PortMapping } from "../containers/types";
import type { FoundContainer } from "../containers/readAll";
import { containerAction } from "../containers/commands";
import { renderCmd } from "../containers/shell";
import { shQuote, shQuoteMinimal as q } from "../../lib/remote";
import type { CloseStep } from "./types";

/** Mismas reglas que los usuarios de Contenedores (`validOwnerUser`). */
const USER_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,31}$/;
const UNIT_RE = /^[A-Za-z0-9:_.@\\-]+\.(service|socket)$/;

export type UnitVerb = "stop" | "disable";

/**
 * Parar (o parar y desactivar) un servicio. Los de `systemctl --user` van como su usuario (con su
 * XDG_RUNTIME_DIR); los tuyos, sin sudo. null si el nombre no es válido.
 */
export function unitStep(unit: string, verb: UnitVerb, scope: { userUnit: boolean; user: string | null; me: string | null }): CloseStep | null {
  if (!UNIT_RE.test(unit)) return null;
  const args = verb === "stop" ? `stop ${q(unit)}` : `disable --now ${q(unit)}`;
  if (!scope.userUnit) return { kind: "shell", show: `systemctl ${args}`, script: `systemctl ${args}`, root: true };
  const user = scope.user ?? scope.me;
  if (!user || !USER_RE.test(user)) return null;
  if (user === scope.me) return { kind: "shell", show: `systemctl --user ${args}`, script: `systemctl --user ${args}`, root: false };
  const inner = `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user ${args}`;
  const script = `if command -v runuser >/dev/null 2>&1; then runuser -u ${q(user)} -- sh -c ${shQuote(inner)}; else su -s /bin/sh ${q(user)} -c ${shQuote(inner)}; fi`;
  return { kind: "shell", show: `runuser -u ${q(user)} -- systemctl --user ${args}`, script, root: true };
}

/** Terminar los procesos que escuchan (con sudo si no son tuyos). */
export function killStep(pids: number[], owner: string | null, me: string | null): CloseStep | null {
  const list = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 1))];
  if (list.length === 0) return null;
  const cmd = `kill ${list.join(" ")}`;
  return { kind: "shell", show: cmd, script: cmd, root: !owner || owner !== me };
}

/** Quién ejecuta el comando del contenedor, para enseñarlo. */
function asWhom(c: FoundContainer): string {
  if (c.ctOwner.kind === "user") return ` (como ${c.ctOwner.user.name})`;
  return c.sudo ? " (con sudo)" : "";
}

/** Parar el contenedor como su dueño. Si lo arranca un servicio de systemd (Quadlet), se para el servicio. */
export function containerStopStep(c: FoundContainer, me: string | null): CloseStep | null {
  const unit = c.labels["PODMAN_SYSTEMD_UNIT"];
  if (unit) return unitStep(unit, "stop", { userUnit: c.user !== "root", user: c.user, me });
  const cmd = containerAction(c.engine, "stop", [c.name]);
  return { kind: "engine", show: `${renderCmd(cmd)}${asWhom(c)}`, cmd, ctr: c };
}

/** La publicación del contenedor que abre ese puerto. */
export function mappingFor(c: Pick<FoundContainer, "ports">, port: number, proto: string): PortMapping | null {
  return c.ports.find((m) => m.hostPort !== null && port >= m.hostPort && port < m.hostPort + Math.max(1, m.range) && m.protocol === proto) ?? null;
}

/** «8080:80» y su versión solo local «127.0.0.1:8080:80» (con /udp si es UDP). */
export function localPublish(m: Pick<PortMapping, "hostIp" | "hostPort" | "containerPort" | "protocol">): { now: string; local: string } {
  const suffix = m.protocol === "udp" ? "/udp" : "";
  const base = `${m.hostPort}:${m.containerPort}${suffix}`;
  const ip = m.hostIp && m.hostIp !== "0.0.0.0" && m.hostIp !== "::" ? `${m.hostIp}:` : "";
  return { now: `${ip}${base}`, local: `127.0.0.1:${base}` };
}
