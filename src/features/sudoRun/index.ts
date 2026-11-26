// Ejecutar un comando con sudo usando la contraseña de sudo de SSHorus (la guardada, la de memoria o la
// del diálogo), en vez de escribirlo en la terminal, donde sudo la pide al servidor y SSHorus no la
// escribe. La contraseña viaja por un canal aparte (`snippets.execSudo`, envoltorio del motor): nunca en
// la línea de comandos ni en la terminal. Lo usan los comandos con sudo, el Monitor y las instalaciones.
import { snippets, type SudoExecResult } from "../../api/snippets";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import { detectPrivilege, getPrivilege, sudoPasswordForCommand, sudoRejectedNotified } from "../privileges";
import { sudoRunError } from "./failure";

export { sudoFailureText, sudoRunError } from "./failure";

/** Límite del canal exec del motor (segundos). */
export const MAX_SUDO_RUN_SECS = 600;

/**
 * Ejecuta `command` (con uno o varios `sudo`) en esa conexión. Sin contraseña si no hace falta (root, sudo
 * sin contraseña). `action`: para qué, en el diálogo («instalar tmux»). null = el usuario no dio la
 * contraseña. Lanza si la conexión falla.
 */
export async function execWithSudo(
  sessionId: string,
  command: string,
  o: { timeoutSecs: number; action: string; execId?: string },
): Promise<SudoExecResult | null> {
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId && t.status !== "closed");
  if (!tab) throw new Error("Esa conexión ya no está abierta");
  const info = getPrivilege(sessionId) ?? (await detectPrivilege(sessionId));
  const got = await sudoPasswordForCommand({
    sessionId,
    profileId: tab.profileId,
    info,
    serverName: tab.title,
    reason: `Para ${o.action} con sudo en «${tab.title}».`,
  });
  if (!got) return null;
  if ("need" in got) return { ...(await snippets.exec(sessionId, command, o.timeoutSecs, o.execId)), sudoFailure: null };
  const r = await snippets.execSudo(sessionId, command, got.password, o.timeoutSecs, o.execId);
  if (r.sudoFailure === "bad-password") sudoRejectedNotified(sessionId);
  return r;
}

/** Instala algo con sudo (ya confirmado por el usuario) y avisa del resultado. true si terminó bien. */
export async function installWithSudo(sessionId: string, command: string, what: string): Promise<boolean> {
  toast.info(`Instalando ${what}…`, "Puede tardar unos minutos.");
  try {
    const r = await execWithSudo(sessionId, command, {
      timeoutSecs: MAX_SUDO_RUN_SECS,
      action: `instalar ${what}`,
    });
    if (!r) return false;
    const err = sudoRunError(r);
    if (err) {
      toast.error(`No se pudo instalar ${what}`, err);
      return false;
    }
    toast.success(`${what} instalado`);
    return true;
  } catch (e) {
    toast.error(`No se pudo instalar ${what}`, e);
    return false;
  }
}
