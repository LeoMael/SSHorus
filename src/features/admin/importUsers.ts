// «Añadir a SSHorus»: usuarios del servidor que pueden entrar, para guardarlos como servidores.
// Funciones puras (sin React ni Tauri): lectura como root (llaves autorizadas, sudo, estado de la contraseña
// SIN hashes), lista de candidatos, perfil nuevo por usuario y plan para instalar llaves públicas.
import type { AuthMethod, ServerProfile } from "../../api/types";
import { normHost } from "../profiles/serverMatches";
import { appendKeySteps, type Plan } from "./commands";
import { checkPublicKey } from "./keyUser";
import { accountState, isLoginShell, parseAccounts, ACCOUNTS_SCRIPT, type AccountState } from "./accounts";
import { type ShadowEntry, type UserRow } from "./parse";
import { splitSections, shQuote } from "../../lib/remote";

// ───────── Lectura (como root) ─────────

/**
 * Llaves autorizadas de cada usuario (sección @@akeys: «usuario tipo base64», sin opciones ni comentario)
 * y después `ACCOUNTS_SCRIPT` (nº de llaves, sudo y estado de las contraseñas; nunca los hashes).
 */
export function userAccessScript(names: string[]): string {
  const list = names.length ? names.map(shQuote).join(" ") : "";
  return [
    "echo @@akeys",
    `for u in ${list}; do`,
    `  h=$(getent passwd "$u" 2>/dev/null | cut -d: -f6)`,
    `  [ -n "$h" ] || h=$(awk -F: -v u="$u" '$1 == u { print $6; exit }' /etc/passwd)`,
    `  f="$h/.ssh/authorized_keys"`,
    `  if [ -n "$h" ] && [ -f "$f" ]; then`,
    `    awk -v u="$u" '!/^[[:space:]]*(#|$)/ { for (i = 1; i < NF; i++) if ($i ~ /^(ssh-|ecdsa-|sk-)/ && $(i + 1) ~ /^AAAA/) { print u " " $i " " $(i + 1); break } }' "$f" 2>/dev/null`,
    `  fi`,
    "done",
    ACCOUNTS_SCRIPT,
  ].join("\n");
}

export interface AccessRead {
  /** Estado de cada cuenta, con sus llaves y su sudo. */
  shadow: Map<string, ShadowEntry>;
  /** Llaves autorizadas por usuario («tipo base64»). */
  authorized: Map<string, string[]>;
}

export function parseUserAccess(stdout: string): AccessRead {
  const s = splitSections(stdout);
  if (!s.has("end")) throw new Error("La lectura de los usuarios quedó incompleta");
  const authorized = new Map<string, string[]>();
  for (const l of s.get("akeys") ?? []) {
    const [name, type, b64] = l.trim().split(/\s+/);
    if (!name || !type || !b64) continue;
    authorized.set(name, [...(authorized.get(name) ?? []), `${type} ${b64}`]);
  }
  return { shadow: parseAccounts(s), authorized };
}

// ───────── Candidatos ─────────

/** Puerto efectivo (0 o vacío → 22). */
function port(p: number): number {
  return Number.isInteger(p) && p > 0 ? p : 22;
}

/** Servidor guardado con el mismo host, puerto y usuario (o null). */
export function findExistingServer(
  servers: readonly ServerProfile[],
  host: string,
  p: number,
  user: string,
): ServerProfile | null {
  const h = normHost(host);
  return servers.find((s) => normHost(s.host) === h && port(s.port) === port(p) && s.username === user) ?? null;
}

export type CandidateKind = "user" | "root" | "system";

export interface ImportCandidate {
  name: string;
  fullName: string;
  uid: number;
  kind: CandidateKind;
  /** Llaves en authorized_keys. null = no se pudo saber. */
  keys: number | null;
  /** Llaves autorizadas («tipo base64»). null = no se pudo saber. */
  authorized: string[] | null;
  /** Estado de la cuenta («Solo llave», «Bloqueada»…), como en la tabla de usuarios. */
  account: AccountState;
  sudo: boolean;
  /** Ya guardado en SSHorus (mismo host, puerto y usuario). */
  existing: ServerProfile | null;
  /** Por qué no se puede elegir (null = se puede). */
  blocked: string | null;
  /** Marcado al abrir: usuario normal con alguna forma de entrar. */
  suggested: boolean;
}

export interface CandidateInput {
  users: readonly UserRow[];
  read: AccessRead | null;
  servers: readonly ServerProfile[];
  host: string;
  port: number;
  /** Días desde 1970 (para la caducidad de las cuentas). */
  today: number;
}

function kindOf(u: UserRow): CandidateKind {
  if (u.uid === 0) return "root";
  return u.isSystem ? "system" : "user";
}

function blockedReason(kind: CandidateKind, u: UserRow, existing: ServerProfile | null): string | null {
  if (existing) return `Ya está en SSHorus: «${existing.name}»`;
  if (kind === "system") return "Cuenta del sistema";
  if (!isLoginShell(u.shell)) return `No puede abrir sesión (shell ${u.shell || "vacío"})`;
  return null;
}

/** Hay alguna forma de entrar: true/false, o null si no se sabe. */
function hasAccess(sh: ShadowEntry | null): boolean | null {
  if (!sh) return null;
  if ((sh.keys ?? 0) > 0 || sh.status === "P") return true;
  return sh.keys === null ? null : false;
}

/** Usuarios del servidor como candidatos: root primero, luego por UID. */
export function buildCandidates(i: CandidateInput): ImportCandidate[] {
  const out = i.users.map((u): ImportCandidate => {
    const kind = kindOf(u);
    const sh = i.read?.shadow.get(u.name) ?? u.shadow;
    const keys = sh?.keys ?? null;
    const existing = findExistingServer(i.servers, i.host, i.port, u.name);
    const blocked = blockedReason(kind, u, existing);
    return {
      name: u.name,
      fullName: u.fullName,
      uid: u.uid,
      kind,
      keys,
      authorized: keys === null ? null : (i.read?.authorized.get(u.name) ?? (i.read ? [] : null)),
      account: accountState({ shell: u.shell, shadow: sh }, i.today),
      sudo: sh?.sudo ? sh.sudo !== "none" : u.isAdmin,
      existing,
      blocked,
      suggested: kind === "user" && !blocked && hasAccess(sh) !== false,
    };
  });
  return out.sort((a, b) => (a.uid === 0 ? -1 : b.uid === 0 ? 1 : a.uid - b.uid));
}

/** Usuarios que conviene leer como root: los que se podrían elegir. */
export function namesToRead(users: readonly UserRow[]): string[] {
  return users.filter((u) => !u.isSystem && isLoginShell(u.shell)).map((u) => u.name);
}

// ───────── Perfiles nuevos ─────────

export type ImportAuth = { kind: "key"; keyPath: string } | { kind: "password" };

/** Perfil de `user` en el mismo host y puerto que `base`, llamado `name`. Llave vacía = agente SSH. Nada secreto. */
export function importedProfile(base: ServerProfile, user: string, name: string, auth: ImportAuth): ServerProfile {
  const keyPath = auth.kind === "key" ? auth.keyPath.trim() : "";
  const method: AuthMethod = auth.kind === "password" ? "password" : keyPath ? "key" : "agent";
  return {
    ...base,
    id: "",
    name: name.trim() || user,
    username: user,
    auth: method,
    keyPath: method === "key" ? keyPath : null,
    defaultPath: null,
    sudoMode: "ask",
  };
}

/** Añade cada llave pública a authorized_keys de su usuario (sin duplicar). Error si una llave no vale. */
export function installKeysPlan(items: readonly { user: string; publicLine: string }[]): Plan | string {
  const steps: string[] = [];
  const labels = new Set<string>();
  for (const it of items) {
    const k = checkPublicKey(it.publicLine);
    if (!k.ok) return `${it.user}: ${k.error}`;
    labels.add(k.comment || k.type);
    steps.push(...appendKeySteps(it.user, k.line.split(/\s+/).slice(0, 2).join(" "), k.line));
  }
  const who = [...new Set(items.map((i) => `«${i.user}»`))].join(", ");
  return { action: `Instalar llave SSH (${[...labels].join(", ")}) en ${who}`, steps };
}
