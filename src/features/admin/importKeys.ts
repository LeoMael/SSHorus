// «Añadir a SSHorus»: cómo entrará cada usuario (llave ya autorizada, llave nueva, llave mía o contraseña),
// qué llaves nuevas se crean en este equipo y qué llaves públicas hay que instalar en el servidor.
// Funciones puras (sin React ni Tauri). El uso de cada llave (GitHub…) lo detecta `features/sshkeys/usage`.
import type { LocalPrivateKey } from "../../api/localkeys";
import { findKey, freeKeyName } from "../sshkeys/keys";
import { publicKeyId, type KeyUsage } from "../sshkeys/usage";
import type { ImportAuth } from "./importUsers";

export type ImportKey = LocalPrivateKey & { usage: Pick<KeyUsage, "github"> };

export type AccessMethod = "authorized" | "new-key" | "my-key" | "password";

/** Datos de un usuario para decidir cómo entra. */
export interface AccessContext {
  /** Llaves de su authorized_keys («tipo base64»). null = no se pudo leer. */
  authorized: readonly string[] | null;
  keys: readonly ImportKey[];
  /** Se pueden instalar llaves (la lectura como root funcionó). */
  canInstall: boolean;
  /** Llave mía propuesta para instalar ("" = ninguna). */
  fallbackKey: string;
}

interface MethodInfo {
  value: AccessMethod;
  label: string;
  available: (c: AccessContext) => boolean;
}

const idOf = (k: ImportKey) => (k.publicLine ? publicKeyId(k.publicLine) : null);

/** Llaves de este equipo que ya están en su authorized_keys (primero las que no son de GitHub). */
export function authorizedKeys<T extends ImportKey>(authorized: readonly string[] | null, keys: readonly T[]): T[] {
  const set = new Set(authorized ?? []);
  const hits = keys.filter((k) => {
    const id = idOf(k);
    return id !== null && set.has(id);
  });
  return [...hits.filter((k) => !k.usage.github), ...hits.filter((k) => k.usage.github)];
}

/** Llaves que se pueden instalar (tienen parte pública). */
export function installableKeys<T extends ImportKey>(keys: readonly T[]): T[] {
  return keys.filter((k) => !!k.publicLine);
}

/** Métodos en el orden del desplegable. */
export const ACCESS_METHODS: readonly MethodInfo[] = [
  { value: "authorized", label: "Llave ya autorizada", available: (c) => authorizedKeys(c.authorized, c.keys).length > 0 },
  { value: "new-key", label: "Crear una llave nueva e instalarla", available: (c) => c.canInstall },
  { value: "my-key", label: "Usar una llave mía e instalarla", available: (c) => installableKeys(c.keys).length > 0 },
  { value: "password", label: "Contraseña", available: () => true },
];

export function availableMethods(c: AccessContext): AccessMethod[] {
  return ACCESS_METHODS.filter((m) => m.available(c)).map((m) => m.value);
}

/** Por defecto: la llave ya autorizada; si no, crear una nueva; sin sudo, contraseña. */
export function defaultMethod(c: AccessContext): AccessMethod {
  const ok = availableMethods(c);
  return (["authorized", "new-key", "password"] as const).find((m) => ok.includes(m)) ?? "password";
}

/** Llave mía por defecto: la del servidor actual o la primera con parte pública, nunca una de GitHub. "" = ninguna. */
export function defaultKeyPath(base: { auth: string; keyPath: string | null } | null, keys: readonly ImportKey[]): string {
  const usable = installableKeys(keys).filter((k) => !k.usage.github);
  const current = base?.auth === "key" && base.keyPath ? findKey(usable, base.keyPath) : null;
  return (current ?? usable[0])?.path ?? "";
}

/** Lo que se cambió a mano en una fila. */
export interface AccessEdit {
  method?: AccessMethod;
  keyPath?: string;
  password?: string;
}

export interface RowAccess {
  method: AccessMethod;
  /** Llave elegida (ya autorizada o mía); "" en los otros métodos o si falta elegirla. */
  keyPath: string;
  password: string;
  /** Hay que añadir una llave a su authorized_keys. */
  install: boolean;
  /** Por qué esta fila no puede seguir (null = bien). */
  problem: string | null;
}

/** Cómo entrará el usuario: lo elegido a mano si aún vale; si no, lo de por defecto. */
export function rowAccess(c: AccessContext, edit: AccessEdit = {}): RowAccess {
  const ok = availableMethods(c);
  const method = edit.method && ok.includes(edit.method) ? edit.method : defaultMethod(c);
  const password = method === "password" ? (edit.password ?? "") : "";
  if (method === "authorized") {
    const list = authorizedKeys(c.authorized, c.keys);
    const keyPath = (findKey(list, edit.keyPath ?? "") ?? list[0])?.path ?? "";
    return { method, keyPath, password, install: false, problem: null };
  }
  if (method === "my-key") {
    const keyPath = findKey(installableKeys(c.keys), edit.keyPath ?? c.fallbackKey)?.path ?? "";
    const already = authorizedKeys(c.authorized, c.keys).some((k) => k.path === keyPath);
    return { method, keyPath, password, install: !!keyPath && !already && c.canInstall, problem: keyPath ? null : "Elige una llave" };
  }
  return { method, keyPath: "", password, install: method === "new-key", problem: null };
}

export type StatusTone = "green" | "accent" | "yellow" | "muted";

/** Etiqueta del estado de la fila («Ya autorizada», «Se instalará»…). */
export function accessStatus(r: RowAccess, canInstall: boolean): { text: string; tone: StatusTone; title: string } {
  if (r.problem) return { text: r.problem, tone: "yellow", title: r.problem };
  switch (r.method) {
    case "authorized":
      return { text: "Ya autorizada", tone: "green", title: "Ya está en su authorized_keys: no hay que instalar nada" };
    case "new-key":
      return { text: "Llave nueva", tone: "accent", title: "Se crea en este equipo y se añade a su authorized_keys" };
    case "my-key":
      if (r.install) return { text: "Se instalará", tone: "accent", title: "Se añade a su authorized_keys antes de guardar" };
      if (!canInstall) return { text: "Sin comprobar", tone: "yellow", title: "Sin sudo no se puede ver ni instalar: tiene que estar ya en su authorized_keys" };
      return { text: "Ya autorizada", tone: "green", title: "Ya está en su authorized_keys" };
    case "password":
      return r.password
        ? { text: "Se guardará", tone: "green", title: "Se guarda como las demás contraseñas de servidores" }
        : { text: "Se pide al conectar", tone: "muted", title: "No se guarda nada: la contraseña se pide al conectar" };
  }
}

// ───────── Llaves nuevas ─────────

/** Texto apto para un nombre de archivo: sin tildes ni espacios, en minúsculas. */
export function keySlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .toLowerCase();
}

/** `id_ed25519_<servidor>_<usuario>` (o sin usuario si es compartida), sin pisar ninguna de `taken`. */
export function newKeyName(server: string, user: string | null, taken: readonly string[]): string {
  const base = ["id_ed25519", keySlug(server), user === null ? "" : keySlug(user)].filter(Boolean).join("_");
  return freeKeyName(taken, base.slice(0, 60).replace(/\.pub$/, ""));
}

/** Una llave nueva y los usuarios que la usan. `id` = el usuario o `SHARED_KEY`. */
export interface NewKeyGroup {
  id: string;
  users: string[];
}

export const SHARED_KEY = "*";

/** Una llave por usuario o, si se pide y son varios, una sola para todos. */
export function newKeyGroups(users: readonly string[], shared: boolean): NewKeyGroup[] {
  if (shared && users.length > 1) return [{ id: SHARED_KEY, users: [...users] }];
  return users.map((u) => ({ id: u, users: [u] }));
}

/** Nombre de archivo de cada grupo que aún no tiene llave creada (`ready`), sin repetir. */
export function nameNewKeys(
  groups: readonly NewKeyGroup[],
  server: string,
  taken: readonly string[],
  ready: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const used = [...taken];
  const out = new Map<string, string>();
  for (const g of groups) {
    if (ready.has(g.id)) continue;
    const name = newKeyName(server, g.id === SHARED_KEY ? null : g.id, used);
    used.push(name);
    out.set(g.id, name);
  }
  return out;
}

/** Pasa un valor por grupo (llave creada, nombre…) a cada usuario del grupo. */
export function byUser<T>(groups: readonly NewKeyGroup[], byGroup: ReadonlyMap<string, T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const g of groups) {
    const v = byGroup.get(g.id);
    if (v !== undefined) for (const u of g.users) out.set(u, v);
  }
  return out;
}

// ───────── Resultado ─────────

export interface NewKey {
  privatePath: string;
  publicLine: string;
}

export interface ChosenRow {
  user: string;
  name: string;
  access: RowAccess;
}

export interface ImportItem {
  user: string;
  name: string;
  auth: ImportAuth;
  /** Contraseña a guardar ("" = ninguna). */
  password: string;
}

/**
 * Servidores a guardar y llaves públicas a instalar. `newKeys`: la llave nueva de cada usuario
 * (por grupo ya resuelto). Error (texto) si a alguna fila le falta algo.
 */
export function importItems(
  rows: readonly ChosenRow[],
  newKeys: ReadonlyMap<string, NewKey>,
  keys: readonly ImportKey[],
): { items: ImportItem[]; install: { user: string; publicLine: string }[] } | string {
  const items: ImportItem[] = [];
  const install: { user: string; publicLine: string }[] = [];
  for (const { user, name, access: a } of rows) {
    if (a.problem) return `${user}: ${a.problem}`;
    let keyPath = a.keyPath;
    let publicLine = a.install ? (findKey(keys, keyPath)?.publicLine ?? "") : "";
    if (a.method === "new-key") {
      const k = newKeys.get(user);
      if (!k) return `${user}: falta crear su llave nueva`;
      keyPath = k.privatePath;
      publicLine = k.publicLine;
    }
    if (a.install) install.push({ user, publicLine });
    const auth: ImportAuth = a.method === "password" ? { kind: "password" } : { kind: "key", keyPath };
    items.push({ user, name, auth, password: a.password });
  }
  return { items, install };
}
