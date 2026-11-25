// Cortafuegos: leer las reglas de un servidor conectado (con sudo si lo hay) y la conexión SSH actual
// (sin sudo: con sudo se pierde $SSH_CONNECTION). Solo lectura.
import type { PortsResult } from "../../admin/ports";
import { GUARD_SCRIPT, sshListenPorts } from "../../audit/fixSafety";
import { readElevated, runScript, type Elevation } from "../../privileges";
import { sshConnFromGuard, sshGuard, type SshGuard } from "./lockout";
import { FIREWALL_SCRIPT, parseFirewallReport } from "./report";
import type { FwReport } from "./types";

export interface FirewallRead {
  report: FwReport;
  guard: SshGuard;
  /** sudo falló (contraseña incorrecta…): se leyó como usuario normal. */
  sudoError: string | null;
}

export async function readFirewall(sessionId: string, el: Elevation | null, profilePort: number, ports: PortsResult | null): Promise<FirewallRead> {
  const [fw, who] = await Promise.all([
    readElevated(sessionId, FIREWALL_SCRIPT, el, 45),
    runScript(sessionId, GUARD_SCRIPT, { kind: "none" }, "", 10).catch(() => null),
  ]);
  const conn = who ? sshConnFromGuard(who.stdout) : null;
  const configured = conn?.serverPort ?? profilePort;
  return {
    report: parseFirewallReport(fw.result.stdout),
    guard: sshGuard(conn, profilePort, sshListenPorts(ports, configured)),
    sudoError: fw.elevationError?.message ?? null,
  };
}
