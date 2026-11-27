// «Comparar archivos»: qué se compara (los dos lados), cómo se llaman y si se puede comparar.
// Lógica pura, sin React ni llamadas al motor.
import { basename, dirname, joinPath } from "../../lib/paths";
import { localBasename } from "../../lib/platform";

/** Un lado de la comparación: un archivo de un servidor (por su conexión abierta) o de este equipo. */
export type CompareSide =
  | { kind: "remote"; sessionId: string; server: string; path: string }
  | { kind: "local"; path: string };

/** Izquierda = la referencia (solo lectura); derecha = la que se puede editar y guardar. */
export interface CompareSpec {
  left: CompareSide;
  right: CompareSide;
}

/** Lo que se leyó de un lado. */
export type SideText =
  | { state: "ok"; content: string; modified: number | null }
  | { state: "missing" }
  | { state: "blocked"; reason: string };

/** Más grande que esto no se compara (como el límite de los archivos locales). */
export const COMPARE_MAX_BYTES = 5 * 1024 * 1024;

/** Nombre del equipo propio en los nombres de los lados. */
export const LOCAL_NAME = "Este equipo";

/** «servidor:ruta» (o «Este equipo:ruta»). */
export function sideLabel(side: CompareSide): string {
  return side.kind === "remote" ? `${side.server}:${side.path}` : `${LOCAL_NAME}:${side.path}`;
}

/** Nombre del archivo, sea ruta remota (/) o local (también \ en Windows). */
export function sideName(side: CompareSide): string {
  return side.kind === "remote" ? basename(side.path) : localBasename(side.path);
}

/** Título corto de la pestaña: «a ↔ b», o «a (comparar)» si los dos se llaman igual. */
export function compareTitle(spec: CompareSpec): string {
  const a = sideName(spec.left);
  const b = sideName(spec.right);
  return a === b ? `${a} (comparar)` : `${a} ↔ ${b}`;
}

export function swapSides(spec: CompareSpec): CompareSpec {
  return { left: spec.right, right: spec.left };
}

export function sameSide(a: CompareSide, b: CompareSide): boolean {
  if (a.kind === "remote" && b.kind === "remote") return a.sessionId === b.sessionId && a.path === b.path;
  return a.kind === b.kind && a.path === b.path;
}

// ── Pestañas de comparación ──
// Viven entre las pestañas de archivo de la sesión con una clave propia. La clave termina en el nombre
// del archivo para que los avisos que muestran `basename(clave)` (cambios sin guardar) se entiendan.

const KEY_PREFIX = "sshorus-compare:";

export function compareKey(n: number, spec: CompareSpec): string {
  return `${KEY_PREFIX}${n}/${sideName(spec.right)}`;
}

export function isCompareKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

// ── Qué se puede comparar ──

interface EntryLike {
  path: string;
  kind: "file" | "dir" | "symlink" | "other";
  isDirLink: boolean;
}

/** Archivo (o enlace a un archivo): lo único que se compara. */
export function isFileLike(e: EntryLike): boolean {
  return (e.kind === "file" || e.kind === "symlink") && !e.isDirLink;
}

/** Dos archivos seleccionados → los dos lados (en el orden de la lista); si no, el motivo. */
export function pairFromSelection(list: readonly EntryLike[]): { ok: true; left: string; right: string } | { ok: false; reason: string } {
  if (list.length !== 2) return { ok: false, reason: "Elige exactamente dos archivos para compararlos." };
  if (!list.every(isFileLike)) return { ok: false, reason: "Solo se comparan archivos, no carpetas." };
  return { ok: true, left: list[0].path, right: list[1].path };
}

/** Si un archivo de `size` bytes se puede comparar; null si sí, o el motivo. */
export function sizeProblem(size: number, max = COMPARE_MAX_BYTES): string | null {
  if (size <= max) return null;
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  return `Es demasiado grande para compararlo (${mb(size)}; máximo ${mb(max)}).`;
}

/** Un texto con caracteres nulos al principio es un archivo binario (como lo decide el editor). */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes("\0");
}

/** Por qué no se comparan los dos lados (uno binario o muy grande), o null si se puede. */
export function blockedMessage(left: SideText, right: SideText): string | null {
  const parts: string[] = [];
  if (left.state === "blocked") parts.push(`Izquierda: ${left.reason}`);
  if (right.state === "blocked") parts.push(`Derecha: ${right.reason}`);
  return parts.length ? parts.join("\n") : null;
}

/** Aviso cuando un lado no existe (se muestra vacío). */
export function missingMessage(left: SideText, right: SideText): string | null {
  const l = left.state === "missing";
  const r = right.state === "missing";
  if (l && r) return "Ninguno de los dos archivos existe.";
  if (l) return "El archivo de la izquierda no existe: se muestra vacío.";
  if (r) return "El archivo de la derecha no existe: se muestra vacío. Si guardas, se crea.";
  return null;
}

// ── «Comparar con…» ──

export type CompareTarget = "local" | "server" | "here" | "backup";

/** Ruta que se propone para el otro lado: la misma en otro servidor; la carpeta del archivo en este. */
export function defaultOtherPath(target: CompareTarget, path: string): string {
  if (target === "here") return joinPath(dirname(path), "");
  return path;
}

/** Ruta remota válida para comparar: completa y no una carpeta («/» al final). */
export function remotePathProblem(path: string): string | null {
  const p = path.trim();
  if (!p) return "Escribe la ruta del archivo.";
  if (!p.startsWith("/")) return "La ruta debe ser completa (empezar por /).";
  if (p.endsWith("/")) return "Falta el nombre del archivo.";
  return null;
}

interface TabLike {
  sessionId: string;
  title: string;
  status: string;
}

/** Otras conexiones abiertas donde buscar «el mismo archivo» (la propia no; otra al mismo servidor, sí). */
export function otherSessions<T extends TabLike>(tabs: readonly T[], sessionId: string): T[] {
  return tabs.filter((t) => t.sessionId !== sessionId && t.status === "connected");
}

// ── Copias de seguridad que ya hace SSHorus junto al archivo ──
// «Editar compose» guarda `<archivo>.bak-sshorus-AAAAMMDD-HHMMSS`; los cambios de sshd, `<archivo>.sshorus.bak`
// y `<archivo>.bak`. No se inventan copias: solo se ofrecen las que están en la carpeta.

export interface BackupCandidate {
  name: string;
  label: string;
}

const DATED = /^(.+)\.bak-sshorus-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;
const PLAIN = [".sshorus.bak", ".bak"];

/** Copias de `name` entre `siblings` (la más nueva primero) y, si `name` es una copia, su original. */
export function backupCandidates(name: string, siblings: readonly string[]): BackupCandidate[] {
  const set = new Set(siblings);
  const out: { c: BackupCandidate; order: string }[] = [];
  for (const s of siblings) {
    const m = DATED.exec(s);
    if (m && m[1] === name) {
      const [, , y, mo, d, h, mi] = m;
      out.push({ c: { name: s, label: `Copia del ${d}/${mo}/${y} ${h}:${mi}` }, order: `1${m.slice(2).join("")}` });
    }
  }
  for (const ext of PLAIN) {
    if (set.has(name + ext)) out.push({ c: { name: name + ext, label: `Copia «${ext}»` }, order: "0" });
  }
  out.sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0));
  const original = originalOf(name);
  const list = out.map((o) => o.c);
  if (original && set.has(original)) list.unshift({ name: original, label: "Archivo original" });
  return list;
}

/** Si `name` es una copia de seguridad conocida, el nombre del original. */
export function originalOf(name: string): string | null {
  const m = DATED.exec(name);
  if (m) return m[1];
  for (const ext of PLAIN) if (name.endsWith(ext) && name.length > ext.length) return name.slice(0, -ext.length);
  return null;
}
