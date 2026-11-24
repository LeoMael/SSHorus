// Qué arreglos son seguros para «Arreglar todo lo seguro» y qué comprobación previa necesitan los que
// pueden dejarte fuera (desactivar la contraseña, prohibir root, activar el cortafuegos).
// Funciones puras: se prueban en fix.test.ts.
import type { AuthMethod } from "../../api/types";
import type { Check } from "../../api/audit";
import type { PortsResult } from "../admin/ports";
import { splitSections } from "../../lib/remote";

/** auto = entra en «Arreglar todo lo seguro» · confirm = uno a uno, con aviso · manual = solo explicación. */
export type FixLevel = "auto" | "confirm" | "manual";

export function fixLevel(c: Check): FixLevel | null {
  if (c.status !== "bad" && c.status !== "warn") return null;
  if (!c.fix || c.fix.manual) return "manual";
  return c.fix.danger ? "confirm" : "auto";
}

/** Los problemas con arreglo seguro, en el orden en que se aplican. */
export function safeFixes(checks: Check[]): Check[] {
  return checks.filter((c) => fixLevel(c) === "auto");
}

/** Arreglos tras los que no se puede volver a comprobar (el servidor se reinicia). */
export const NO_RECHECK = new Set(["updates.reboot"]);

// ───────── Puertos de SSH ─────────

/** Puertos TCP donde escucha sshd hacia fuera (el cortafuegos debe dejarlos abiertos). */
export function sshListenPorts(ports: PortsResult | null, configured: number): number[] {
  const found = (ports?.ports ?? [])
    .filter((p) => p.proto === "tcp" && p.scope !== "local")
    .filter((p) => p.procs.some((x) => /^sshd\b/.test(x.name)) || /^sshd?\.(socket|service)$/.test(p.unit ?? ""))
    .map((p) => p.port);
  return [...new Set([configured, ...found])].sort((a, b) => a - b);
}

/** El comando del cortafuegos deja pasar ese puerto (por número o, para el 22, por el servicio «ssh»). */
export function firewallKeepsPort(command: string, port: number): boolean {
  return new RegExp(`(^|[^0-9])${port}/tcp\\b`).test(command) || (port === 22 && command.includes("--add-service=ssh"));
}

// ───────── Comprobación previa ─────────

/**
 * Se lee como el usuario conectado (sin sudo): con sudo se pierden $SSH_CONNECTION y el usuario real.
 * @@who «usuario» y «ip puerto ip puertoDelServidor» · @@keys «n» llaves en su authorized_keys.
 */
export const GUARD_SCRIPT = [
  "echo @@who; id -un; echo \"${SSH_CONNECTION:-}\"",
  "echo @@keys; f=\"$HOME/.ssh/authorized_keys\"; if [ -r \"$f\" ]; then grep -cvE '^[[:space:]]*(#|$)' \"$f\"; else echo 0; fi",
  "echo @@end",
].join("\n");

export interface GuardInfo {
  /** Usuario con el que entra SSHorus. */
  user: string;
  /** Puerto del servidor de esta conexión (null si no se supo). */
  serverPort: number | null;
  /** Llaves en su authorized_keys. */
  keys: number;
  /** Cómo entra SSHorus a este servidor. */
  auth: AuthMethod | null;
}

export function parseGuard(stdout: string, auth: AuthMethod | null): GuardInfo {
  const s = splitSections(stdout);
  const who = s.get("who") ?? [];
  const port = Number((who[1] ?? "").trim().split(/\s+/)[3]);
  const keys = Number((s.get("keys") ?? [])[0]);
  return { user: who[0]?.trim() ?? "", serverPort: Number.isInteger(port) && port > 0 ? port : null, keys: Number.isFinite(keys) ? keys : 0, auth };
}

/** Qué comprobaciones necesitan la lectura previa. */
export function needsGuard(c: Check): boolean {
  return c.id === "ssh.password" || c.id === "ssh.root" || c.id === "net.firewall";
}

/** Motivo para NO aplicar el arreglo (te dejaría fuera), o null si se puede. */
export function guardProblem(c: Check, g: GuardInfo): string | null {
  switch (c.id) {
    case "ssh.password":
      if (g.auth === "password") return "SSHorus entra a este servidor con contraseña: cambia el servidor a llave SSH y vuelve a conectar antes.";
      if (g.keys < 1) return `«${g.user || "tu usuario"}» no tiene ninguna llave en ~/.ssh/authorized_keys: instala una antes (Usuarios → Llaves).`;
      return null;
    case "ssh.root":
      return g.user === "root" ? "Te conectas como root: crea otro usuario con sudo y entra con él antes." : null;
    case "net.firewall":
      if (g.serverPort !== null && c.fix && !firewallKeepsPort(c.fix.command, g.serverPort))
        return `Esta conexión usa el puerto ${g.serverPort} y el cortafuegos lo cerraría: vuelve a auditar con sudo para que lo incluya.`;
      return null;
    default:
      return null;
  }
}

/** Lo que se comprobó, en una línea, para enseñarlo antes de confirmar. */
export function guardOkText(c: Check, g: GuardInfo): string | null {
  switch (c.id) {
    case "ssh.password":
      return `Comprobado: «${g.user}» tiene ${g.keys} ${g.keys === 1 ? "llave" : "llaves"} y SSHorus entra con llave.`;
    case "ssh.root":
      return `Comprobado: entras como «${g.user}», no como root.`;
    case "net.firewall":
      return g.serverPort !== null ? `Comprobado: el puerto de esta conexión (${g.serverPort}) queda abierto.` : null;
    default:
      return null;
  }
}
