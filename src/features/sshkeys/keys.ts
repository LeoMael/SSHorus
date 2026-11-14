// Llaves SSH de este equipo: funciones puras (etiquetas, rutas, nombres libres).
import type { LocalPrivateKey } from "../../api/localkeys";

/** Página de GitHub para añadir una llave SSH. */
export const GITHUB_NEW_KEY_URL = "https://github.com/settings/ssh/new";

/** Nombres que ssh prueba solo (no hace falta decirle qué llave usar). */
const DEFAULT_IDENTITIES = ["id_ed25519", "id_ecdsa", "id_rsa", "id_ed25519_sk", "id_ecdsa_sk"];

/** Texto corto de una llave: «ed25519 · ana@pc · con frase». */
export function keyDetails(k: LocalPrivateKey): string {
  return [k.kind ?? "tipo desconocido", k.comment, k.encrypted ? "con frase" : ""].filter(Boolean).join(" · ");
}

/** Opción del desplegable: «id_ed25519 (ed25519 · ana@pc)». */
export function keyLabel(k: LocalPrivateKey): string {
  return `${k.name} (${keyDetails(k)})`;
}

/** Ruta con «/» y sin «~» al principio, para comparar. */
function norm(p: string): string {
  return p.trim().replace(/\\/g, "/");
}

/** Misma llave aunque una ruta use «~/…» y la otra sea absoluta. */
export function samePath(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = (p: string) => (p.startsWith("~/") ? p.slice(1) : null);
  const tx = tail(x);
  const ty = tail(y);
  if (tx) return y.endsWith(tx);
  if (ty) return x.endsWith(ty);
  return false;
}

/** Llave de la lista que corresponde a `path`. */
export function findKey(keys: readonly LocalPrivateKey[], path: string): LocalPrivateKey | null {
  return keys.find((k) => samePath(k.path, path)) ?? null;
}

/** Primer nombre libre: `base`, `base_2`, `base_3`… */
export function freeKeyName(taken: readonly string[], base = "id_ed25519"): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base}_${i}`;
    if (!used.has(n)) return n;
  }
}

/** Comando para probar la llave con GitHub (con `-i` si ssh no la usa sola). */
export function githubTestCommand(name: string, privatePath: string): string {
  if (DEFAULT_IDENTITIES.includes(name)) return "ssh -T git@github.com";
  const p = norm(privatePath).includes(" ") ? `"${privatePath}"` : privatePath;
  return `ssh -i ${p} -T git@github.com`;
}
