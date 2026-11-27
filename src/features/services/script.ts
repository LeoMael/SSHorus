// Scripts de Servicios: lista del sistema (systemd u OpenRC), lista `--user` de un usuario y registro de
// un servicio. Solo leen. Los nombres que llegan del servidor se validan y se citan con shQuote.
import { shQuote } from "../../lib/remote";
import { ownerLine, type OwnerUser } from "../containers";
import type { HumanUser } from "./parse";

const PRELUDE = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin; export PATH; LC_ALL=C; export LC_ALL";

/** Secciones: @@me · @@init (systemd / openrc / none) · @@units + @@files o @@rc + @@rcboot · @@humans. */
export const SERVICES_SCRIPT = [
  PRELUDE,
  "echo @@me; id -un",
  "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then I=systemd",
  // Sin /run/openrc es que el sistema no arrancó con OpenRC (p. ej. un contenedor): sus scripts no valen.
  "elif command -v rc-status >/dev/null 2>&1 && [ -d /run/openrc ]; then I=openrc; else I=none; fi",
  "echo @@init; echo $I",
  "if [ $I = systemd ]; then",
  "  echo @@units; systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null",
  "  echo @@files; systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null",
  "elif [ $I = openrc ]; then",
  "  echo @@rc; rc-status --servicelist 2>/dev/null",
  "  echo @@rcboot; rc-update show -v 2>/dev/null",
  "fi",
  "echo @@humans",
  "{ getent passwd 2>/dev/null || cat /etc/passwd; } | awk -F: '$3>=1000 && $3<60000 {print $1\"|\"$3\"|\"$6}' | while IFS='|' read -r n u h; do",
  "  r=0; [ -d /run/user/$u ] && r=1; echo \"$n|$u|$h|$r\"",
  "done",
  "echo @@end",
].join("\n");

/** Lo que se ejecuta ya como el usuario: sus servicios `--user` (@@ok si su gestor respondió). */
export const USER_SERVICES_SCRIPT = [
  "U=$(systemctl --user list-units --type=service --all --no-legend --plain --no-pager 2>&1) || { echo @@err; printf '%s\\n' \"$U\"; echo @@end; exit 0; }",
  "echo @@ok; echo @@units; printf '%s\\n' \"$U\"",
  "echo @@files; systemctl --user list-unit-files --type=service --no-legend --no-pager 2>/dev/null",
  "echo @@end",
].join("\n");

/** Nombre de unidad de systemd aceptado (lo que sale de list-units). */
const UNIT_RE = /^[A-Za-z0-9:_.@\\-]+\.service$/;
/** Nombre de servicio de OpenRC (un archivo de /etc/init.d). */
const RC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validUnit(unit: string, init: "systemd" | "openrc"): boolean {
  return (init === "systemd" ? UNIT_RE : RC_RE).test(unit) && unit.length <= 200;
}

export function asOwnerUser(h: HumanUser): OwnerUser {
  return { name: h.name, uid: h.uid, home: h.home, podman: true, docker: false, runtimeDir: h.runtimeDir };
}

/**
 * Un comando como el usuario `h`, ya siendo root: `runuser -u … -- env HOME=… XDG_RUNTIME_DIR=…` (o
 * `su` si no hay runuser), igual que Contenedores entra como el dueño de sus contenedores.
 */
export function asUserLine(h: HumanUser, bin: string, args: string[], runuser = true): string {
  return ownerLine({ bin: [bin], args }, { kind: "user", user: asOwnerUser(h) }, { engine: "podman", elevPrefix: "", selfPrefix: "", runuser });
}

/** Leer los servicios `--user` de otro usuario, como root. */
export function userServicesAsRoot(h: HumanUser): string {
  return [
    PRELUDE,
    `if command -v runuser >/dev/null 2>&1; then ${asUserLine(h, "sh", ["-c", USER_SERVICES_SCRIPT])}`,
    `else ${asUserLine(h, "sh", ["-c", USER_SERVICES_SCRIPT], false)}; fi`,
  ].join("\n");
}

export interface LogTarget {
  init: "systemd" | "openrc";
  unit: string;
  /** Servicio `--user` de este usuario (null = del sistema). */
  user: HumanUser | null;
}

/** Las últimas `lines` líneas del registro (root ve todo; un servicio de usuario se busca por su UID). */
export function logsScript(t: LogTarget, lines = 200, follow = false): string {
  const unit = shQuote(t.unit);
  const who = t.user ? `--user-unit=${unit} _UID=${t.user.uid}` : `-u ${unit}`;
  const base = `journalctl ${who} --no-pager -o short-iso`;
  if (follow) {
    // Se corta solo a los 5 minutos: al cerrar el canal, un journalctl de root no recibe la señal.
    return `${PRELUDE}\nT=; command -v timeout >/dev/null 2>&1 && T='timeout 300'\nexec $T ${base} -n 0 -f 2>&1`;
  }
  return `${PRELUDE}\necho @@log\n${base} -n ${Math.max(1, Math.floor(lines))} 2>&1\necho @@end`;
}

/** Registro de un servicio de tu propio usuario, sin sudo. */
export function ownLogsScript(unit: string, lines = 200): string {
  return `${PRELUDE}\necho @@log\njournalctl --user -u ${shQuote(unit)} --no-pager -o short-iso -n ${Math.max(1, Math.floor(lines))} 2>&1\necho @@end`;
}
