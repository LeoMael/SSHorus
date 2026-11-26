// Respuesta a las peticiones de sudo del motor (`sudo` y `sudo-reveal`, ver core/elevation.rs → `sudo_answer`)
// y textos del diálogo de la contraseña. Funciones puras, sin React ni Tauri, para poder probarlas.
import type { NoPasswordWhy } from "../privileges";

/** Respuesta al motor. */
export type SudoReply = { elevate: false; why: NoPasswordWhy } | { elevate: true; password: string } | { canceled: true };

/** Para qué la pide el motor: un comando ya aprobado (la IA no la ve) o `request_sudo_password` (se la da). */
export type SudoPurpose = "command" | "reveal";

/** Texto del diálogo de la contraseña (si hay que escribirla). */
export function sudoAskReason(o: { purpose: SudoPurpose; serverName: string; auto?: boolean; reason?: string }): string {
  if (o.purpose === "reveal") {
    const why = o.reason ? ` Motivo: «${o.reason}».` : "";
    return `Permitiste que la IA vea la contraseña de sudo de «${o.serverName}».${why} Escríbela para dársela: quedará en la conversación con la IA.`;
  }
  const how = o.auto ? "aceptado automáticamente" : "ya le diste permiso";
  return `El asistente quiere ejecutar un comando con sudo en «${o.serverName}» (${how}). SSHorus le pasa la contraseña a sudo: el asistente no la ve.`;
}
