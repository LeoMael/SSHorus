// «Claude Code en este servidor con tu cuenta»: leer el estado, llevar la cuenta, quitarla y crear la llave en
// una terminal local. La cuenta viaja siempre por el motor (src-tauri/src/localterm/claude_vps/).
import { localTerm, type ClaudeVpsSent } from "../../api/localterm";
import { failureText, runScript, succeeded } from "../privileges";
import { detectAssistants, openLocalTab } from "../localterm";
import { toast } from "../../stores/toasts";
import { REMOVE_SCRIPT, STATUS_SCRIPT, parseRemove, parseStatus, type ClaudeVpsStatus, type RemoveResult } from "./scripts";
import { SETUP_TOKEN_COMMAND, cleanToken, type ClaudeVpsMode } from "./model";

const NONE = { kind: "none" } as const;

/** Qué hay en el servidor (como el usuario con el que se entró). */
export async function readStatus(sessionId: string): Promise<ClaudeVpsStatus> {
  const r = await runScript(sessionId, STATUS_SCRIPT, NONE, "", 30);
  const st = succeeded(r) ? parseStatus(r.stdout) : null;
  if (!st) throw new Error(`No se pudo ver si Claude Code está en el servidor: ${failureText(r)}`);
  return st;
}

/** Lleva la cuenta: con la sesión del PC (la lee el motor) o con la llave pegada. */
export function sendAccount(sessionId: string, mode: ClaudeVpsMode, pastedToken = ""): Promise<ClaudeVpsSent> {
  return mode === "session" ? localTerm.claudeVpsCopySession(sessionId) : localTerm.claudeVpsSetToken(sessionId, cleanToken(pastedToken));
}

/** Quita del servidor lo que puso SSHorus. */
export async function removeAccount(sessionId: string): Promise<RemoveResult> {
  const r = await runScript(sessionId, REMOVE_SCRIPT, NONE, "", 30);
  const res = parseRemove(r.stdout);
  if (!res) throw new Error(`No se pudo quitar tu cuenta del servidor: ${failureText(r)}`);
  return res;
}

/**
 * Abre una terminal local con `claude setup-token`: el navegador se abre ahí y la llave se copia de ahí.
 * false si Claude Code no está instalado en este equipo (lo dice un aviso).
 */
export async function openSetupToken(serverName: string): Promise<boolean> {
  const tools = await detectAssistants();
  if (!tools) return false;
  if (!tools.some((t) => t.tool === "claude" && t.installed)) {
    toast.info(
      "Claude Code no está instalado en este equipo",
      "La llave se crea con Claude Code en este equipo: ábrelo desde el menú de terminal local para instalarlo, o usa «Copiar mi sesión».",
    );
    return false;
  }
  openLocalTab({
    kind: "shell",
    intro: [
      "Creando la llave de acceso de Claude Code. Termina en el navegador y copia la llave que aparece aquí (empieza por sk-ant-oat01-).",
      `Después vuelve a la pestaña de «${serverName}», pulsa otra vez el botón de Claude Code y pégala en «Llave de acceso».`,
    ],
    initialInput: `${SETUP_TOKEN_COMMAND}\r`,
  });
  return true;
}

/** Forma elegida por última vez en cada sesión (al volver de crear la llave sigue elegida la llave). */
const lastMode = new Map<string, ClaudeVpsMode>();

export function rememberMode(sessionId: string, mode: ClaudeVpsMode) {
  lastMode.set(sessionId, mode);
}

export function rememberedMode(sessionId: string): ClaudeVpsMode | null {
  return lastMode.get(sessionId) ?? null;
}
