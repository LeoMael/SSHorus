// Lo que el motor de «Ejecutar en varios servidores» necesita de fuera. Se inyecta para poder
// probarlo con llamadas simuladas (sin Tauri).
import type { ExecResult } from "../../api/types";
import type { SudoExecResult } from "../../api/snippets";
import type { PrivilegeHint } from "./types";

export interface EngineDeps {
  /** Sesión conectada de una pestaña del usuario para ese servidor (se reutiliza), o null. */
  tabSession(profileId: string): string | null;
  /** Conecta sin interacción con las credenciales guardadas. Devuelve el sessionId. Lanza errores con `.kind`. */
  connect(profileId: string): Promise<string>;
  /** Conecta resolviendo diálogos (contraseña, huella, 2FA). null = el usuario canceló. */
  connectInteractive(profileId: string): Promise<string | null>;
  /** Ejecuta con un identificador (`execId`) para poder cancelarlo con `cancelExec`. */
  exec(sessionId: string, command: string, timeoutSecs: number, execId: string): Promise<ExecResult>;
  /** Identificador nuevo y único para `exec`. */
  newExecId(): string;
  /** Pide detener en el servidor la ejecución `execId`. false = no estaba (aún no empezó o ya terminó). */
  cancelExec(execId: string): Promise<boolean>;
  disconnect(sessionId: string): Promise<void>;
  /** Nivel de privilegios (solo lectura, informativo). */
  privilege(sessionId: string, reused: boolean): Promise<PrivilegeHint | null>;
  /**
   * Contraseña de sudo para ejecutar en esa sesión (en memoria → guardada → otra pestaña → diálogo en cola).
   * `{ need: false }`: no hace falta (root, sudo sin contraseña, sin sudo). null: el usuario saltó el
   * servidor (o se abortó con `signal`).
   */
  sudoPassword?(
    sessionId: string,
    profileId: string,
    serverName: string,
    signal: AbortSignal,
  ): Promise<{ password: string } | { need: false } | null>;
  /** Ejecuta con la contraseña de sudo (envoltorio del motor). */
  execSudo?(sessionId: string, command: string, password: string, timeoutSecs: number, execId: string): Promise<SudoExecResult>;
  /** sudo rechazó la contraseña: se olvida y, si era la guardada, queda marcada como rechazada. */
  sudoRejected?(sessionId: string): void;
}
