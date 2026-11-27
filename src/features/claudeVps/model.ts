// Formas de llevar la cuenta de Claude Code al servidor, textos y comandos que se escriben en la terminal.
// Puros, sin React ni Tauri.
import { shQuoteMinimal } from "../../lib/remote";
import { ENV_FILE, TOKEN_FILE } from "./layout";
import type { ClaudeVpsStatus } from "./scripts";

export type ClaudeVpsMode = "token" | "session";

export interface ModeDef {
  mode: ClaudeVpsMode;
  label: string;
  /** La diferencia, en una línea. */
  line: string;
  recommended: boolean;
}

/** Las dos formas, en el orden en que se muestran (la recomendada primero). */
export const MODES: readonly ModeDef[] = [
  {
    mode: "token",
    label: "Llave de acceso",
    line: "Oficial y dura un año: se crea una vez en este equipo con el navegador y no toca tu sesión del PC.",
    recommended: true,
  },
  {
    mode: "session",
    label: "Copiar mi sesión",
    line: "Rápido y sin navegador, pero no oficial y compartida: si un equipo renueva la sesión, el otro puede quedarse fuera.",
    recommended: false,
  },
];

/** Aviso que siempre se muestra. */
export const ROOT_WARNING = "Quien tenga acceso de administrador (root) en este servidor podrá usar tu cuenta de Claude.";

/** Comando que crea la llave en este equipo (en una terminal local). */
export const SETUP_TOKEN_COMMAND = "claude setup-token";

const INSTALL_URL = "https://claude.ai/install.sh";

/** Comando oficial para instalar Claude Code en el servidor (null = falta bash o curl/wget). */
export function installCommand(st: Pick<ClaudeVpsStatus, "curl" | "wget" | "bash">): string | null {
  if (!st.bash) return null;
  if (st.curl) return `curl -fsSL ${INSTALL_URL} | bash`;
  if (st.wget) return `wget -qO- ${INSTALL_URL} | bash`;
  return null;
}

/** Por qué no se puede instalar desde aquí (si `installCommand` es null). */
export function installBlocker(st: Pick<ClaudeVpsStatus, "curl" | "wget" | "bash">): string {
  if (!st.bash) return "El instalador oficial necesita bash, y este servidor no lo tiene.";
  return "El instalador oficial necesita curl o wget, y este servidor no tiene ninguno.";
}

/** `~/…` en vez de la ruta completa de la carpeta personal (más corto de leer en la terminal). */
function tildePath(path: string, home: string): string {
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

/**
 * Lo que se escribe en la terminal SSH para abrir Claude Code. Con la llave, la shell que ya estaba abierta
 * aún no la tiene: primero se carga (leyendo el archivo; la llave nunca se escribe en la terminal ni queda
 * en el historial). Si `claude` no está en el PATH, se abre con su ruta.
 */
export function launchCommand(st: Pick<ClaudeVpsStatus, "claude" | "onPath" | "shell" | "home">, mode: ClaudeVpsMode | null): string {
  const program = st.onPath || !st.claude ? "claude" : shQuoteMinimal(tildePath(st.claude, st.home));
  if (mode !== "token") return program;
  if (st.shell === "fish") return `set -gx CLAUDE_CODE_OAUTH_TOKEN (cat ${TOKEN_FILE.replace("$HOME", "~")}); ${program}`;
  return `. "${ENV_FILE}"; ${program}`;
}

/** Quita los espacios y saltos de línea que mete la terminal al copiar una llave larga. */
export function cleanToken(pasted: string): string {
  return pasted.replace(/\s+/g, "");
}

/** ¿Tiene la forma de una llave de `claude setup-token`? (El motor lo vuelve a comprobar.) */
export function looksLikeToken(token: string): boolean {
  return /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{80,}$/.test(token);
}

/** Qué cuenta tiene ya el servidor (null = ninguna puesta por SSHorus). */
export function currentAccount(st: Pick<ClaudeVpsStatus, "session" | "token">): string | null {
  if (st.session && st.token) return "Ya está tu cuenta en este servidor (sesión copiada y llave de acceso).";
  if (st.token) return "Ya está tu cuenta en este servidor (llave de acceso).";
  if (st.session) return "Ya está tu cuenta en este servidor (sesión copiada).";
  return null;
}

/** Modo con el que se abre Claude Code según lo que hay (la llave gana: hay que cargarla en la shell). */
export function activeMode(st: Pick<ClaudeVpsStatus, "session" | "token">): ClaudeVpsMode | null {
  if (st.token) return "token";
  return st.session ? "session" : null;
}
