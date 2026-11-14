// Acciones sobre el servidor desde el Monitor.
import { snippets } from "../../api/snippets";
import { execWithSudo, sudoFailureText } from "../sudoRun";
import { buildKillCommand, parseKillOutput, type KillResult } from "./sample";

/**
 * Envía TERM (o KILL con `force`) al proceso y comprueba un segundo después si sigue vivo. Con `sudo`, como
 * root con la contraseña de sudo de SSHorus (procesos de otros usuarios).
 */
export async function killProcess(sessionId: string, pid: number, force: boolean, sudo = false): Promise<KillResult> {
  if (!sudo) {
    const r = await snippets.exec(sessionId, buildKillCommand(pid, force), 10);
    return parseKillOutput(r.stdout, r.stderr);
  }
  const r = await execWithSudo(sessionId, `sudo ${buildKillCommand(pid, force)}`, {
    timeoutSecs: 20,
    action: `terminar el proceso ${pid}`,
  });
  if (!r) return { ok: false, alive: false, permission: false, message: "Cancelado: sin contraseña de sudo" };
  if (r.sudoFailure) return { ok: false, alive: false, permission: false, message: sudoFailureText(r.sudoFailure) };
  return parseKillOutput(r.stdout, r.stderr);
}
