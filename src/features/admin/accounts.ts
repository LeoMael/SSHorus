// Estado real de cada cuenta: contraseña (/etc/shadow), llaves autorizadas, shell y sudo.
// Una contraseña bloqueada («!») o desactivada («*») con llaves en authorized_keys NO es una cuenta
// bloqueada: entra con su llave («Solo llave»). Funciones puras (sin React ni Tauri).
import { daysToDate, parseShadow, SHADOW_SCRIPT, UID_MIN, type ShadowEntry, type SudoAccess } from "./parse";
import { splitSections } from "../../lib/remote";

/** Shells que no dejan abrir una sesión (nologin, false, git-shell…). */
const NO_LOGIN_RE = /(^|\/)(nologin|false|sync|shutdown|halt|git-shell)$/;

export function isLoginShell(shell: string): boolean {
  const t = shell.trim();
  return t.startsWith("/") && !NO_LOGIN_RE.test(t);
}

/**
 * Como root: por cada usuario que puede abrir sesión (root y UID ≥ 1000), cuántas llaves tiene en
 * authorized_keys y qué sudo tiene («usuario:llaves:sudo»; llaves «?» = no se pudo leer; sudo 0 = no,
 * 1 = con contraseña, 2 = NOPASSWD: ALL, «-» = sin sudo instalado). Después, /etc/shadow (sin hashes).
 */
export const ACCOUNTS_SCRIPT = [
  "echo @@keys",
  `awk -F: '$3 == 0 || ($3 >= ${UID_MIN} && $3 != 65534) { print $1 ":" $6 ":" $7 }' /etc/passwd | while IFS=: read -r u h sh; do`,
  `  case "$sh" in ""|*/nologin|*/false|*/sync|*/shutdown|*/halt|*/git-shell) continue;; esac`,
  `  k=0; f="$h/.ssh/authorized_keys"`,
  `  if [ -f "$f" ]; then k=$(grep -cEv '^[[:space:]]*(#|$)' "$f" 2>/dev/null || true); k=\${k:-?}; fi`,
  `  s=-`,
  `  if command -v sudo >/dev/null 2>&1; then`,
  `    l=$(LC_ALL=C sudo -n -l -U "$u" 2>/dev/null)`,
  `    case "$l" in *"may run the following"*) case "$l" in *"NOPASSWD: ALL"*) s=2;; *) s=1;; esac;; *) s=0;; esac`,
  `  fi`,
  `  printf '%s:%s:%s\\n' "$u" "$k" "$s"`,
  "done",
  SHADOW_SCRIPT,
].join("\n");

const SUDO: Record<string, SudoAccess> = { "0": "none", "1": "password", "2": "nopasswd" };

/** Añade llaves y sudo (sección @@keys) a las entradas de /etc/shadow. */
export function withLoginAccess(shadow: Map<string, ShadowEntry>, keyLines: readonly string[]): Map<string, ShadowEntry> {
  for (const l of keyLines) {
    const [name, k, s] = l.split(":");
    const e = name ? shadow.get(name) : undefined;
    if (!e || k === undefined) continue;
    e.keys = /^\d+$/.test(k) ? Number(k) : null;
    e.sudo = SUDO[s ?? ""] ?? null;
  }
  return shadow;
}

/** Salida de `ACCOUNTS_SCRIPT` (o de un script que lo incluya). */
export function parseAccounts(sections: Map<string, string[]>): Map<string, ShadowEntry> {
  if (!sections.has("end")) throw new Error("No se pudo leer /etc/shadow");
  return withLoginAccess(parseShadow(sections.get("shadow") ?? []), sections.get("keys") ?? []);
}

export function parseAccountsOutput(stdout: string): Map<string, ShadowEntry> {
  return parseAccounts(splitSections(stdout));
}

// ───────── Estado para mostrar ─────────

export type AccountKind = "unknown" | "active" | "change" | "empty" | "key-only" | "locked";

export interface AccountState {
  kind: AccountKind;
  /** Explicación al pasar el ratón. */
  title: string;
  /** «Solo llave» con sudo que pide contraseña: no podrá usar sudo. */
  sudoWarning: string | null;
}

export const KEY_ONLY_SUDO_WARNING = "sudo le pedirá una contraseña que no tiene: ponle una o dale sudo sin contraseña";

/** Días desde 1970 de hoy (para comparar con la caducidad de /etc/shadow). */
export function todayDays(now = Date.now()): number {
  return Math.floor(now / 86400000);
}

function state(kind: AccountKind, title: string, sudoWarning: string | null = null): AccountState {
  return { kind, title, sudoWarning };
}

export function accountState(u: { shell: string; shadow: ShadowEntry | null }, today: number): AccountState {
  const sh = u.shadow;
  if (!sh) return state("unknown", "Hace falta root o sudo para saberlo");
  if (sh.expireDays !== null && sh.expireDays <= today) return state("locked", `La cuenta caducó el ${daysToDate(sh.expireDays)}`);
  if (!isLoginShell(u.shell)) return state("locked", `Su shell (${u.shell.trim() || "vacía"}) no deja abrir sesión`);
  if (sh.status === "L" || sh.status === "NL") {
    if (sh.keys !== null && sh.keys > 0) {
      return state("key-only", "La contraseña está desactivada; entra con su llave SSH", sh.sudo === "password" ? KEY_ONLY_SUDO_WARNING : null);
    }
    if (sh.keys === 0) return state("locked", sh.status === "L" ? "Contraseña bloqueada y sin llaves SSH" : "Sin contraseña ni llaves SSH");
    return state("locked", "Contraseña desactivada (no se pudo leer authorized_keys)");
  }
  if (sh.status === "NP") return state("empty", "Contraseña vacía: sshd no la acepta");
  if (sh.lastChange === 0) return state("change", "Debe cambiar la contraseña al entrar");
  return state("active", sh.expireDays !== null ? `La cuenta caduca el ${daysToDate(sh.expireDays)}` : "Puede entrar con contraseña");
}
