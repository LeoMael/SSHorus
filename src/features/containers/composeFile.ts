// Leer y guardar el archivo compose de un proyecto como su dueño (tú, root u otro usuario, con sudo).
// El contenido viaja en base64. Al guardar se escribe ENCIMA del archivo (`cat >`): conserva dueño,
// grupo, permisos y contexto SELinux; antes se hace una copia `.bak-sshorus-<fecha>`. Funciones puras.
import { shQuote, splitSections } from "../../lib/remote";
import { COMPOSE_FILES } from "./commands";

/** Tamaño máximo que se abre en el editor. */
export const MAX_COMPOSE_EDIT_BYTES = 2 * 1024 * 1024;

const STAT = `stat -c '%s %Y %U %G %a' -- "$f"`;

/** Ruta absoluta del archivo compose (sin archivo conocido, null: se busca con `findComposeFileScript`). */
export function composeFilePath(dir: string, file: string): string | null {
  if (file.startsWith("/")) return file;
  if (!file) return null;
  return `${dir.replace(/\/+$/, "")}/${file}`;
}

/** Busca el primer archivo compose de la carpeta y escribe su ruta. */
export function findComposeFileScript(dir: string): string {
  return [`cd -- ${shQuote(dir)} || exit 1`, `for f in ${COMPOSE_FILES.join(" ")}; do if [ -f "$f" ]; then echo "$(pwd -P)/$f"; exit 0; fi; done`, "exit 3"].join("\n");
}

export interface FileMeta {
  size: number;
  /** Unix segundos. */
  modified: number | null;
  owner: string;
  group: string;
  /** Permisos en octal («644»). */
  mode: string;
}

function parseMeta(lines: string[] | undefined): FileMeta | null {
  const m = /^(\d+) (\d+) (\S+) (\S+) ([0-7]{3,4})$/.exec((lines?.[0] ?? "").trim());
  return m ? { size: Number(m[1]), modified: Number(m[2]), owner: m[3], group: m[4], mode: m[5] } : null;
}

export function readFileScript(path: string): string {
  return [
    `f=${shQuote(path)}`,
    'if [ ! -e "$f" ]; then echo @@missing; exit 0; fi',
    `if [ ! -f "$f" ]; then echo "No es un archivo normal: $f" >&2; exit 1; fi`,
    `if [ ! -r "$f" ]; then echo "Sin permiso para leer $f" >&2; exit 1; fi`,
    "echo @@meta",
    STAT,
    `if [ "$(stat -c %s -- "$f")" -gt ${MAX_COMPOSE_EDIT_BYTES} ]; then echo @@toobig; exit 0; fi`,
    "echo @@data",
    'base64 <"$f"',
    "echo @@end",
  ].join("\n");
}

/** Solo los datos del archivo (para ver si cambió antes de guardar). */
export function statFileScript(path: string): string {
  return [`f=${shQuote(path)}`, 'if [ ! -e "$f" ]; then echo @@missing; exit 0; fi', "echo @@meta", STAT, "echo @@end"].join("\n");
}

export type FileRead = { kind: "missing" } | { kind: "toobig"; meta: FileMeta } | { kind: "ok"; meta: FileMeta; content: string };

export function parseReadFile(stdout: string): FileRead {
  const s = splitSections(stdout);
  if (s.has("missing")) return { kind: "missing" };
  const meta = parseMeta(s.get("meta"));
  if (!meta) throw new Error("El servidor no devolvió los datos del archivo");
  if (s.has("toobig")) return { kind: "toobig", meta };
  if (!s.has("end")) throw new Error("El archivo llegó incompleto");
  const content = decodeBase64Text((s.get("data") ?? []).join(""));
  return { kind: "ok", meta, content };
}

/** Datos actuales del archivo (null = ya no existe). */
export function parseStatFile(stdout: string): FileMeta | null {
  const s = splitSections(stdout);
  if (s.has("missing")) return null;
  const meta = parseMeta(s.get("meta"));
  if (!meta) throw new Error("El servidor no devolvió los datos del archivo");
  return meta;
}

const EOF_MARK = "SSHORUS_B64_EOF";

/** Guarda `content` encima de `path`. Con `backup`, copia antes el archivo a `<ruta>.bak-sshorus-<fecha>`. */
export function writeFileScript(path: string, content: string, backup: boolean): string {
  return [
    `f=${shQuote(path)}`,
    `t=$(mktemp "\${TMPDIR:-/tmp}/sshorus-edit.XXXXXX") || { echo "No se pudo crear un archivo temporal" >&2; exit 1; }`,
    `trap 'rm -f "$t"' EXIT`,
    `base64 -d >"$t" <<'${EOF_MARK}' || { echo "No se pudo preparar el contenido" >&2; exit 1; }`,
    ...wrap76(encodeBase64Text(content)),
    EOF_MARK,
    "b=",
    backup
      ? `if [ -e "$f" ]; then b="$f.bak-sshorus-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$f" "$b" || { echo "No se pudo crear la copia de seguridad $b" >&2; exit 1; }; fi`
      : ":",
    `cat -- "$t" >"$f" || { echo "No se pudo escribir $f" >&2; exit 1; }`,
    "echo @@meta",
    STAT,
    "echo @@backup",
    'echo "$b"',
    "echo @@end",
  ].join("\n");
}

export function parseWriteFile(stdout: string): { meta: FileMeta; backup: string | null } {
  const s = splitSections(stdout);
  const meta = parseMeta(s.get("meta"));
  if (!meta || !s.has("end")) throw new Error("No se pudo confirmar que el archivo quedó guardado");
  return { meta, backup: s.get("backup")?.[0]?.trim() || null };
}

function wrap76(b64: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out;
}

export function encodeBase64Text(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Texto UTF-8 desde base64. Lanza si no es texto (archivo binario). */
export function decodeBase64Text(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("No es un archivo de texto (UTF-8)");
  }
}
