// Contraseña de sudo para los comandos del asistente (petición `sudo` del motor, ver uiBridge.ts) y para
// `request_sudo_password` ya permitida (petición `sudo-reveal`). La pide la cola de diálogos de
// features/privileges/sudoAsk.ts (`sudoPasswordForCommand`), la misma de los demás comandos con sudo.
//
// Con «Aceptar automáticamente: todo» no se muestra nada si la contraseña ya está en memoria o guardada: el
// diálogo solo aparece (una vez) si no hay ninguna.
// El motor la pasa por stdin a un envoltorio que se la da a sudo; el asistente nunca la ve.
import { detectPrivilege, getPrivilege, sudoPasswordForCommand } from "../privileges";
import { useLock } from "../lock/lockStore";
import { useTabs } from "../../stores/tabs";
import { sudoAskReason, type SudoPurpose, type SudoReply } from "./sudoReply";

export type { SudoReply } from "./sudoReply";

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Peticiones `sudo` (`purpose` "command") y `sudo-reveal` ("reveal") del motor: { sessionId, profileId,
 * serverName, timeoutSecs, auto, reason }. Las dos llegan ya permitidas por el usuario.
 */
export async function sudoForAssistant(payload: Record<string, unknown>, purpose: SudoPurpose = "command"): Promise<SudoReply> {
  const sessionId = str(payload.sessionId);
  if (!sessionId) throw new Error("Falta la conexión");
  const tab = useTabs.getState().tabs.find((t) => t.sessionId === sessionId && t.status !== "closed");
  if (!tab) throw new Error("Esa conexión ya no está abierta en SSHorus");
  if (useLock.getState().status?.locked) throw new Error("SSHorus está bloqueado");
  const profileId = str(payload.profileId) ?? tab.profileId;
  const info = getPrivilege(sessionId) ?? (await detectPrivilege(sessionId));
  const secs = typeof payload.timeoutSecs === "number" && payload.timeoutSecs > 0 ? payload.timeoutSecs : 120;
  const serverName = str(payload.serverName) ?? tab.title;
  const auto = payload.auto === true;
  const got = await sudoPasswordForCommand({
    sessionId,
    profileId,
    info,
    serverName,
    auto,
    reason: sudoAskReason({ purpose, serverName, auto, reason: str(payload.reason) ?? undefined }),
    expiresAt: Date.now() + secs * 1000,
  });
  if (useLock.getState().status?.locked) throw new Error("SSHorus está bloqueado");
  if (!got) return { canceled: true };
  return "need" in got ? { elevate: false, why: got.why } : { elevate: true, password: got.password };
}
