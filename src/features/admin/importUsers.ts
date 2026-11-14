// «Añadir a SSHorus»: usuarios del servidor que pueden entrar, para guardarlos como servidores.
// Funciones puras (sin React ni Tauri): lectura como root (llaves, sudo, estado de la contraseña SIN hashes),
// lista de candidatos, perfil nuevo por usuario y plan para instalar una llave pública.
import type { AuthMethod, ServerProfile } from "../../api/types";
import type { LocalPublicKey } from "../../api/localkeys";
import { normHost } from "../serverMatches";
import { appendKeySteps, type Plan } from "./commands";
import { checkPublicKey } from "./keyUser";
import { parseShadow, splitSections, SHADOW_SCRIPT, type ShadowEntry, type ShadowStatus, type UserRow } from "./parse";
import { shQuote } from "./shell";

// ───────── Lectura (como root) ─────────

/**
 * Por cada usuario: cuántas llaves tiene en ~/.ssh/authorized_keys y si `sudo -l -U` le deja usar sudo.
 * Sección @@access con líneas «usuario:llaves:sudo» («?» = no se pudo leer, «-» = no aplica). Después,
 * el estado de las contraseñas de /etc/shadow (P, L, NP, NL; nunca los hashes). Siempre sale bien.
 */
export function userAccessScript(names: string[]): string {
  const list = names.length ? names.map(shQuote).join(" ") : "";
  return [
    "echo @@access",
    `for u in ${list}; do`,
    `  h=$(getent passwd "$u" 2>/dev/null | cut -d: -f6)`,
    `  [ -n "$h" ] || h=$(awk -F: -v u="$u" '$1 == u { print $6; exit }' /etc/passwd)`,
    `  k=-`,
    `  if [ -n "$h" ]; then if [ -f "$h/.ssh/authorized_keys" ]; then k=$(grep -cEv '^[[:space:]]*(#|$)' "$h/.ssh/authorized_keys" 2>/dev/null || true); k=\${k:-?}; else k=0; fi; fi`,
    `  s=-`,
    `  if command -v sudo >/dev/null 2>&1; then if LC_ALL=C sudo -n -l -U "$u" 2>/dev/null | grep -q 'may run the following'; then s=1; else s=0; fi; fi`,
    `  printf '%s:%s:%s\\n' "$u" "$k" "$s"`,
    "done",
    SHADOW_SCRIPT,
  ].join("\n");
}

export interface UserAccess {
  /** Llaves en authorized_keys. null = no se pudo saber. */
  keys: number | null;
  /** sudo -l -U lo permite. null = no se pudo saber (sin sudo instalado o sin leer). */
  sudo: boolean | null;
}

export interface AccessRead {
  access: Map<string, UserAccess>;
  shadow: Map<string, ShadowEntry>;
}

export function parseUserAccess(stdout: string): AccessRead {
  const s = splitSections(stdout);
  if (!s.has("end")) throw new Error("La lectura de los usuarios quedó incompleta");
  const access = new Map<string, UserAccess>();
  for (const l of s.get("access") ?? []) {
    const [name, k, sudo] = l.split(":");
    if (!name || k === undefined || sudo === undefined) continue;
    access.set(name, {
      keys: /^\d+$/.test(k) ? Number(k) : null,
      sudo: sudo === "1" ? true : sudo === "0" ? false : null,
    });
  }
  return { access, shadow: parseShadow(s.get("shadow") ?? []) };
}

// ───────── Candidatos ─────────

/** Shells que no dejan abrir una sesión (nologin, false, git-shell…). */
const NO_LOGIN_RE = /(^|\/)(nologin|false|sync|shutdown|halt|git-shell)$/;

export function isLoginShell(shell: string): boolean {
  const t = shell.trim();
  return t.startsWith("/") && !NO_LOGIN_RE.test(t);
}

export type PasswordState = "active" | "locked" | "empty" | "none" | "unknown";

/** P = activa, L = bloqueada, NP = vacía (sshd no la acepta), NL = sin contraseña («*»: solo llave). */
export function passwordState(status: ShadowStatus | null | undefined): PasswordState {
  switch (status) {
    case "P":
      return "active";
    case "L":
      return "locked";
    case "NP":
      return "empty";
    case "NL":
      return "none";
    default:
      return "unknown";
  }
}

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
  keys: number | null;
  password: PasswordState;
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
function hasAccess(keys: number | null, password: PasswordState): boolean | null {
  if ((keys ?? 0) > 0 || password === "active") return true;
  if (keys === null || password === "unknown") return null;
  return false;
}

/** Usuarios del servidor como candidatos: root primero, luego por UID. */
export function buildCandidates(i: CandidateInput): ImportCandidate[] {
  const out = i.users.map((u): ImportCandidate => {
    const kind = kindOf(u);
    const acc = i.read?.access.get(u.name);
    const keys = acc?.keys ?? null;
    const password = passwordState((i.read?.shadow.get(u.name) ?? u.shadow)?.status);
    const existing = findExistingServer(i.servers, i.host, i.port, u.name);
    const blocked = blockedReason(kind, u, existing);
    return {
      name: u.name,
      fullName: u.fullName,
      uid: u.uid,
      kind,
      keys,
      password,
      sudo: u.isAdmin || acc?.sudo === true,
      existing,
      blocked,
      suggested: kind === "user" && !blocked && hasAccess(keys, password) !== false,
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

/** Perfil de `user` en el mismo host y puerto que `base`. Llave vacía = agente SSH. Nada secreto. */
export function importedProfile(base: ServerProfile, user: string, auth: ImportAuth): ServerProfile {
  const keyPath = auth.kind === "key" ? auth.keyPath.trim() : "";
  const method: AuthMethod = auth.kind === "password" ? "password" : keyPath ? "key" : "agent";
  return {
    ...base,
    id: "",
    name: `${base.name} (${user})`,
    username: user,
    auth: method,
    keyPath: method === "key" ? keyPath : null,
    defaultPath: null,
    sudoMode: "ask",
  };
}

/** Llave pública local que corresponde a la privada `keyPath` («~/.ssh/x» o ruta absoluta). */
export function findLocalPublicKey(locals: readonly LocalPublicKey[], keyPath: string): LocalPublicKey | null {
  const p = keyPath.trim().replace(/\\/g, "/");
  if (!p) return null;
  const tail = p.startsWith("~") ? p.slice(1) : null;
  return (
    locals.find((l) => {
      const priv = (l.privatePath ?? "").replace(/\\/g, "/");
      return priv !== "" && (priv === p || (tail !== null && priv.endsWith(tail)));
    }) ?? null
  );
}

/** Añade la llave pública a authorized_keys de cada usuario (sin duplicar). Error si la llave no vale. */
export function installKeyPlan(users: readonly string[], publicLine: string): Plan | string {
  const k = checkPublicKey(publicLine);
  if (!k.ok) return k.error;
  const id = k.line.split(/\s+/).slice(0, 2).join(" ");
  const who = users.map((u) => `«${u}»`).join(", ");
  return {
    action: `Instalar llave SSH (${k.comment || k.type}) en ${who}`,
    steps: users.flatMap((u) => appendKeySteps(u, id, k.line)),
  };
}
