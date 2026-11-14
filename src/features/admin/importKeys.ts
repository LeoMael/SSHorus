// «Añadir a SSHorus»: qué llave de este equipo usará cada usuario.
// Si una llave local ya está en su authorized_keys, esa; si no, la de por defecto (nunca una de GitHub).
// Funciones puras (sin React ni Tauri). El uso de cada llave lo detecta `features/sshkeys/usage`.
import type { LocalPrivateKey } from "../../api/localkeys";
import { findKey } from "../sshkeys/keys";
import { publicKeyId, type KeyUsage } from "../sshkeys/usage";

export type ImportKey = LocalPrivateKey & { usage: Pick<KeyUsage, "github"> };

const idOf = (k: ImportKey) => (k.publicLine ? publicKeyId(k.publicLine) : null);

/** Llave por defecto: la del servidor actual (si no es de GitHub) o la primera local que no lo sea. "" = agente SSH. */
export function defaultKeyPath(base: { auth: string; keyPath: string | null } | null, keys: readonly ImportKey[]): string {
  if (base?.auth === "agent") return "";
  if (base?.auth === "key" && base.keyPath && !findKey(keys, base.keyPath)?.usage.github) return base.keyPath;
  return keys.find((k) => k.publicLine && !k.usage.github)?.path ?? "";
}

/** Una llave local ya autorizada para el usuario (mejor si no es de GitHub) o la de por defecto. */
export function autoKeyPath(authorized: readonly string[] | null, keys: readonly ImportKey[], fallback: string): string {
  const set = new Set(authorized ?? []);
  const hits = keys.filter((k) => {
    const id = idOf(k);
    return id !== null && set.has(id);
  });
  return (hits.find((k) => !k.usage.github) ?? hits[0])?.path ?? fallback;
}

/** authorized = ya está en su authorized_keys · install = se instalará · no-public = sin parte pública · agent = agente SSH. */
export type KeySource = "authorized" | "install" | "no-public" | "agent";

export function keySource(keyPath: string, authorized: readonly string[] | null, keys: readonly ImportKey[]): KeySource {
  if (!keyPath.trim()) return "agent";
  const k = findKey(keys, keyPath);
  const id = k ? idOf(k) : null;
  if (!id) return "no-public";
  return authorized?.includes(id) ? "authorized" : "install";
}
