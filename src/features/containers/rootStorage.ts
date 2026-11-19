// Podman de un usuario normal que arranca con las carpetas de root (/var/lib/containers/storage y
// /run/containers/storage, de /usr/share/containers/storage.conf) aunque su base de datos
// (~/.local/share/containers/storage/db.sql, tabla DBConfig) tenga las suyas. Visto con podman 6 y
// containers-common 5.8 (Rocky 10). Se arregla creando, como él, ~/.config/containers/storage.conf con
// su graphroot y el runroot que ya tiene la base de datos. Funciones puras.
import { parseKeyValues } from "../privileges/detect";
import { OWNER_SELF, ownerKey, type CtOwner } from "./owner";
import { q, type Cmd } from "./shell";
import type { Engine } from "./types";

/** El error que deja Podman en ese caso (también cortado y en una línea, como lo guarda la detección). */
export const ROOT_STORAGE_RE =
  /run root path "?\/run\/containers\/storage|runroot is pointing to a path \(\/run\/containers\/storage\)|\/run\/containers\/storage.{0,80}permission denied|\/var\/lib\/containers\/storage.{0,80}permission denied/i;

/** Mensaje para ese caso (en el panel sale el aviso con «Arreglar»). */
export const ROOT_STORAGE_PROBLEM =
  "Podman de este usuario usa las carpetas de root (/var/lib/containers y /run/containers) en vez de las suyas: " +
  "le falta su propio ~/.config/containers/storage.conf";

export function usesRootStorage(text: string | null | undefined): boolean {
  return !!text && ROOT_STORAGE_RE.test(text);
}

/** Solo lectura: rutas del usuario, si ya tiene storage.conf y qué dice su base de datos. */
const DB_READ_PY = [
  "import sqlite3, sys, urllib.parse",
  'c = sqlite3.connect("file:" + urllib.parse.quote(sys.argv[1]) + "?mode=ro", uri=True)',
  'r = c.execute("SELECT GraphRoot, RunRoot FROM DBConfig").fetchone()',
  "if r:",
  '    print("db_graphroot=" + (r[0] or ""))',
  '    print("db_runroot=" + (r[1] or ""))',
].join("\n");

export const STORAGE_PROBE_SCRIPT = [
  "echo tv_begin=1",
  'echo "uid=$(id -u 2>/dev/null)"',
  'echo "home=$HOME"',
  'f="$HOME/.config/containers/storage.conf"',
  `if [ -e "$f" ]; then echo conf=1; grep -E '^[[:space:]]*(driver|graphroot|runroot)[[:space:]]*=' "$f" 2>/dev/null | head -n 6 | sed 's/^/conf_line=/'; fi`,
  'db="$HOME/.local/share/containers/storage/db.sql"',
  'if [ -f "$db" ]; then echo db=1; fi',
  "if command -v python3 >/dev/null 2>&1; then echo python=1; fi",
  `if [ -f "$db" ] && command -v python3 >/dev/null 2>&1; then python3 -c '${DB_READ_PY}' "$db" 2>/dev/null || echo db_read=0; fi`,
  "echo tv_end=1",
].join("\n");

export interface StorageProbe {
  ok: boolean;
  uid: number | null;
  home: string | null;
  /** Ya tiene ~/.config/containers/storage.conf (no se toca). */
  confExists: boolean;
  /** Sus líneas driver / graphroot / runroot, para explicar qué revisar. */
  confLines: string[];
  db: boolean;
  python: boolean;
  dbGraphRoot: string | null;
  dbRunRoot: string | null;
}

export function parseStorageProbe(stdout: string): StorageProbe {
  const kv = parseKeyValues(stdout);
  const confLines = stdout
    .split("\n")
    .flatMap((l) => (l.startsWith("conf_line=") ? [l.slice("conf_line=".length).trim()] : []))
    .filter(Boolean);
  return {
    ok: kv.tv_begin === "1" && kv.tv_end === "1",
    uid: /^\d+$/.test(kv.uid ?? "") ? Number(kv.uid) : null,
    home: kv.home || null,
    confExists: kv.conf === "1",
    confLines,
    db: kv.db === "1",
    python: kv.python === "1",
    dbGraphRoot: kv.db_graphroot || null,
    dbRunRoot: kv.db_runroot || null,
  };
}

/** Ruta absoluta que se puede escribir tal cual en una cadena TOML y que no es de root. */
export function usablePath(p: string | null | undefined): p is string {
  if (!p || !p.startsWith("/") || /["\\\x00-\x1f\x7f]/.test(p)) return false;
  return !/^\/(run|var\/lib)\/containers(\/|$)/.test(p);
}

export type RunrootSource = "db" | "default";

/** RunRoot del usuario: el de su base de datos si sirve; si no, el de Podman sin root. */
export function decideRunroot(p: Pick<StorageProbe, "uid" | "dbRunRoot">): { path: string; source: RunrootSource } | null {
  if (usablePath(p.dbRunRoot)) return { path: p.dbRunRoot, source: "db" };
  if (p.uid === null || p.uid === 0) return null;
  return { path: `/run/user/${p.uid}/containers`, source: "default" };
}

export function graphrootOf(home: string): string {
  return `${home.replace(/\/+$/, "")}/.local/share/containers/storage`;
}

/** Contenido de ~/.config/containers/storage.conf. */
export function storageConfText(graphroot: string, runroot: string): string {
  return ["[storage]", 'driver = "overlay"', `graphroot = "${graphroot}"`, `runroot = "${runroot}"`].join("\n");
}

export interface StorageFix {
  /** Ruta del archivo que se crea. */
  file: string;
  text: string;
  runrootSource: RunrootSource;
  /** Comando (sin dueño): `sh -c` con el script que lo crea, sin sobrescribir nunca. */
  cmd: Cmd;
}

/**
 * Lo que hay que hacer según la comprobación: null si falta algún dato o si ya existe storage.conf
 * (entonces solo se explica qué revisar). El archivo se crea con `set -C` (noclobber): si aparece
 * entre la comprobación y la ejecución, falla en vez de pisarlo.
 */
export function storageFix(p: StorageProbe): StorageFix | null {
  if (!p.ok || p.confExists || !usablePath(p.home)) return null;
  const rr = decideRunroot(p);
  if (!rr) return null;
  const dir = `${p.home.replace(/\/+$/, "")}/.config/containers`;
  const file = `${dir}/storage.conf`;
  const text = storageConfText(graphrootOf(p.home), rr.path);
  const script = [
    "set -e",
    `f=${q(file)}`,
    `if [ -e "$f" ]; then echo "Ya existe $f: no se ha tocado" >&2; exit 1; fi`,
    `mkdir -p ${q(dir)}`,
    `(set -C; cat > "$f") <<'SSHORUS_EOF'`,
    text,
    "SSHORUS_EOF",
    'echo "Creado $f"',
  ].join("\n");
  return { file, text, runrootSource: rr.source, cmd: { bin: ["sh", "-c"], args: [script] } };
}

/** Qué revisar si el usuario ya tiene storage.conf (no se sobrescribe). */
export function existingConfAdvice(p: StorageProbe): string {
  const home = p.home ?? "~";
  const rr = decideRunroot(p);
  const want = [`graphroot = "${graphrootOf(home)}"`, rr ? `runroot = "${rr.path}"` : null].filter(Boolean).join("\n");
  const has = p.confLines.length ? p.confLines.join("\n") : "(no define driver, graphroot ni runroot)";
  return `Ahora tiene:\n${has}\n\nDebería apuntar a sus propias carpetas, por ejemplo:\n${want}`;
}

/** Dueños (Podman) cuyo último error es este: tú (también si falló la detección) y los demás usuarios. */
export function rootStorageOwners(o: {
  engine: Engine;
  isRoot: boolean;
  /** Error de la detección para ti (`EngineStatus.rawError`). */
  selfError: string | null;
  owners: CtOwner[];
  /** Último error de cada dueño (por su clave). */
  errors: Record<string, string>;
}): CtOwner[] {
  if (o.engine !== "podman") return [];
  const out: CtOwner[] = [];
  if (!o.isRoot && (usesRootStorage(o.selfError) || usesRootStorage(o.errors[OWNER_SELF]))) out.push({ kind: "self" });
  for (const w of o.owners) if (w.kind === "user" && usesRootStorage(o.errors[ownerKey(w)])) out.push(w);
  return out;
}
