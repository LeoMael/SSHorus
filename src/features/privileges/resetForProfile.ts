// Al cambiar la contraseña de sudo guardada de un servidor (o su modo), sus pestañas abiertas vuelven a
// mirarla. Aparte de sudo.ts (que carga también la ventana del editor) y de stored.ts (que importa el
// store de servidores, y este lo importa a él).
import { useTabs } from "../../stores/tabs";
import { resetStoredSudo } from "./sudo";

/** `sudoChanged`: cambió la contraseña de sudo o de dónde sale (ver `resetStoredState`). */
export function resetStoredSudoForProfile(profileId: string, sudoChanged: boolean): void {
  const sessions = useTabs.getState().tabs.filter((t) => t.profileId === profileId).map((t) => t.sessionId);
  resetStoredSudo(sessions, sudoChanged);
}
