// Cortafuegos: que un cambio no te deje fuera. Se sabe qué puerto usa esta conexión ($SSH_CONNECTION,
// el del perfil y los de sshd en `ss`) y, antes de quitar algo, se simula cómo quedaría. Funciones puras.
import type { ApiErrorKind } from "../../../api/types";
import { splitSections } from "../../../lib/remote";
import type { FwChange } from "./commands";
import { reach, ruleCovers, type ReachQuery } from "./reach";
import type { FwReport, SshConn } from "./types";

/** «1.2.3.4 51000 10.0.0.5 22» ($SSH_CONNECTION) → quién entra y por dónde. */
export function parseSshConnection(line: string | undefined): SshConn | null {
  const [clientIp, , serverIp, port] = (line ?? "").trim().split(/\s+/);
  const serverPort = Number(port);
  if (!clientIp || !serverIp || !Number.isInteger(serverPort) || serverPort < 1) return null;
  return { clientIp, serverIp, serverPort };
}

/** La conexión de la salida de GUARD_SCRIPT (auditoría): sección @@who, segunda línea. */
export function sshConnFromGuard(stdout: string): SshConn | null {
  return parseSshConnection(splitSections(stdout).get("who")?.[1]);
}

export interface SshGuard {
  /** Puertos de SSH que deben seguir abiertos (el de esta conexión primero). */
  ports: number[];
  conn: SshConn | null;
}

/** Puertos a proteger: el de esta conexión (o el del perfil) y los de sshd hacia fuera. */
export function sshGuard(conn: SshConn | null, profilePort: number, sshdPorts: number[]): SshGuard {
  const first = conn?.serverPort ?? profilePort;
  return { ports: [...new Set([first, ...sshdPorts])], conn };
}

function queryFor(port: number, g: SshGuard): ReachQuery {
  return { port, proto: "tcp", from: g.conn?.clientIp ?? null, localIp: g.conn?.serverIp ?? null };
}

/** Cómo quedaría el cortafuegos tras el cambio (para comprobar antes de hacerlo). */
export function simulate(report: FwReport, change: FwChange): FwReport {
  if (change.kind === "remove") {
    const keep = (r: { id: string }) => r.id !== change.rule.id;
    return { ...report, rules: report.rules.filter(keep), chains: report.chains.map((c) => ({ ...c, rules: c.rules.filter(keep) })) };
  }
  if (change.kind === "enable" && report.tool === "ufw") {
    return { ...report, active: true, rules: report.ufwAdded, ufwDefaults: report.ufwDefaults ?? { incoming: "deny", outgoing: "allow", routed: "disabled" } };
  }
  return report;
}

/** Puertos de SSH que quedarían cerrados al activar el cortafuegos (hay que abrirlos antes). */
export function sshPortsToOpen(report: FwReport, g: SshGuard): number[] {
  if (report.tool === "firewalld") return g.ports; // parado no se puede leer su configuración: se abren siempre
  const after = simulate(report, { kind: "enable", sshPorts: [] });
  return g.ports.filter((p) => reach(after, queryFor(p, g)) !== "allowed");
}

/** Motivo para NO hacer el cambio (te dejaría fuera), o null si es seguro. */
export function lockoutProblem(report: FwReport, change: FwChange, g: SshGuard): string | null {
  if (change.kind !== "remove") return null;
  const after = simulate(report, change);
  for (const port of g.ports) {
    if (ruleCovers(change.rule, port, "tcp", report) === false) continue;
    const q = queryFor(port, g);
    if (reach(after, q) === "allowed") continue;
    if (reach(report, q) === "blocked") continue;
    return `Esta regla deja entrar SSH (puerto ${port}), que es por donde entra SSHorus: si la quitas te quedarías fuera. Abre antes el puerto ${port} de otra forma.`;
  }
  return null;
}

export type LoginCheck = "ok" | "blocked" | "unclear";

/**
 * Resultado de la prueba de conexión nueva: si se llegó a hablar con SSH (aunque pida contraseña o
 * código), el cortafuegos deja pasar. Solo un error de red dice que se cerró.
 */
export function loginCheck(errorKind: ApiErrorKind | null): LoginCheck {
  if (errorKind === null) return "ok";
  if (errorKind === "Network") return "blocked";
  const reached: ApiErrorKind[] = ["AuthFailed", "NeedsPassword", "NeedsPassphrase", "NeedsOtp", "HostKeyUnknown", "HostKeyChanged"];
  return reached.includes(errorKind) ? "ok" : "unclear";
}
