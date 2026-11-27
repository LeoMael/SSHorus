// Scripts sin secretos para «Claude Code en este servidor»: ver qué hay y quitar la cuenta. Puros, sin React
// ni Tauri. Corren como el usuario con el que se entró (POSIX sh, también busybox).
import { BACKUP_FILE, CREDS_FILE, DIR, ENV_FILE, FISH_FILE, RC_FILES, RC_MARK, SESSION_MARK, TOKEN_FILE } from "./layout";

/** Sitios donde suele quedar `claude` aunque no esté en el PATH de un canal sin terminal. */
const CLAUDE_PLACES = ["$HOME/.local/bin/claude", "$HOME/.claude/local/claude", "$HOME/.npm-global/bin/claude", "/usr/local/bin/claude"];

/** Lee el estado: líneas `clave=valor`. */
export const STATUS_SCRIPT = [
  `echo "user=$(id -un 2>/dev/null)"`,
  `echo "home=$HOME"`,
  `echo "shell=\${SHELL##*/}"`,
  `p=$(command -v claude 2>/dev/null) && echo onpath=1 || p=""`,
  `for x in ${CLAUDE_PLACES.map((x) => `"${x}"`).join(" ")}; do [ -n "$p" ] && break; [ -x "$x" ] && p="$x"; done`,
  `echo "claude=$p"`,
  `[ -n "$p" ] && echo "version=$("$p" --version 2>/dev/null | head -n 1)"`,
  `[ -f "${SESSION_MARK}" ] && echo session=1`,
  `[ -f "${TOKEN_FILE}" ] && echo token=1`,
  `[ -f "${CREDS_FILE}" ] && echo creds=1`,
  `command -v curl >/dev/null 2>&1 && echo curl=1`,
  `command -v wget >/dev/null 2>&1 && echo wget=1`,
  `command -v bash >/dev/null 2>&1 && echo bash=1`,
  `echo end=1`,
].join("\n");

export interface ClaudeVpsStatus {
  /** Usuario del servidor que recibe la cuenta. */
  user: string;
  /** Carpeta personal. */
  home: string;
  /** Shell de login (bash, zsh, fish…). */
  shell: string;
  /** Ruta de `claude` ("" = no está instalado). */
  claude: string;
  /** `claude` está en el PATH (si no, se abre con su ruta). */
  onPath: boolean;
  version: string;
  /** SSHorus copió la sesión del PC. */
  session: boolean;
  /** SSHorus dejó una llave de acceso. */
  token: boolean;
  /** Hay una sesión de Claude Code en el servidor (la copiada o una propia). */
  creds: boolean;
  curl: boolean;
  wget: boolean;
  bash: boolean;
}

/** Interpreta la salida de `STATUS_SCRIPT`; null si no llegó entera. */
export function parseStatus(stdout: string): ClaudeVpsStatus | null {
  const kv = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  if (kv.get("end") !== "1") return null;
  const on = (k: string) => kv.get(k) === "1";
  return {
    user: kv.get("user") ?? "",
    home: kv.get("home") ?? "",
    shell: kv.get("shell") ?? "",
    claude: kv.get("claude") ?? "",
    onPath: on("onpath"),
    version: kv.get("version") ?? "",
    session: on("session"),
    token: on("token"),
    creds: on("creds"),
    curl: on("curl"),
    wget: on("wget"),
    bash: on("bash"),
  };
}

/**
 * Quita lo que puso SSHorus: la sesión copiada (o repone la que había), la llave y la línea de los archivos
 * de inicio. No toca una sesión de Claude Code que no puso SSHorus. Dice qué quitó (`session=1`, `token=1`,
 * `restored=1`).
 */
export const REMOVE_SCRIPT = [
  `m="${RC_MARK}"`,
  `if [ -f "${SESSION_MARK}" ]; then`,
  `  if [ -f "${BACKUP_FILE}" ]; then mv -f "${BACKUP_FILE}" "${CREDS_FILE}" && echo restored=1; else rm -f "${CREDS_FILE}"; fi`,
  `  rm -f "${SESSION_MARK}" && echo session=1`,
  `fi`,
  `if [ -f "${TOKEN_FILE}" ] || [ -f "${ENV_FILE}" ]; then echo token=1; fi`,
  `rm -f "${TOKEN_FILE}" "${ENV_FILE}" "${FISH_FILE}"`,
  `for f in ${RC_FILES.join(" ")}; do`,
  `  r="$HOME/$f"`,
  `  if [ -f "$r" ] && grep -qF "$m" "$r"; then`,
  `    grep -vF "$m" "$r" > "$r.sshorus-tmp"; cat "$r.sshorus-tmp" > "$r" && rm -f "$r.sshorus-tmp"`,
  `  fi`,
  `done`,
  `rmdir "${DIR}" 2>/dev/null`,
  `echo end=1`,
].join("\n");

export interface RemoveResult {
  session: boolean;
  token: boolean;
  /** Se repuso la sesión que el servidor tenía antes de copiar la del PC. */
  restored: boolean;
}

/** Interpreta la salida de `REMOVE_SCRIPT`; null si no terminó. */
export function parseRemove(stdout: string): RemoveResult | null {
  const lines = new Set(stdout.split("\n").map((l) => l.trim()));
  if (!lines.has("end=1")) return null;
  return { session: lines.has("session=1"), token: lines.has("token=1"), restored: lines.has("restored=1") };
}
