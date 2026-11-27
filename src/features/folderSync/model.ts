// «Sincronizar carpeta», lo puro: textos de estado, lista de patrones y resumen de la comparación.
import type { SavedSync, SyncInfo, SyncPreview, SyncSpec } from "../../api/folderSync";
import { basename } from "../../lib/paths";
import { formatBytes } from "../../lib/format";

/** Lo que el motor ignora siempre (para explicarlo en el diálogo). */
export const ALWAYS_IGNORED = ".git, node_modules, temporales de editores (*.swp, *~, .#*) y .sshorusignore";

/** Texto del cuadro de patrones → lista (sin vacías ni comentarios). */
export function parseIgnore(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function ignoreText(list: string[]): string {
  return list.join("\n");
}

/** Último nombre de una ruta local (Windows o Unix). */
export function localName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** «web → /var/www/html». */
export function syncLabel(spec: SyncSpec): string {
  return `${localName(spec.localDir)} → ${spec.remoteDir}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es")} ${n === 1 ? one : many}`;
}

/** «hace 5 s», «hace 3 min», «hace 2 h». */
export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

/** Estado en pocas palabras: «Al día», «Subiendo 3», «En pausa», «Error: …». */
export function statusText(i: SyncInfo): string {
  switch (i.state) {
    case "paused":
      return "En pausa";
    case "waiting":
      return i.pending ? `Esperando la conexión (${plural(i.pending, "cambio", "cambios")})` : "Esperando la conexión";
    case "uploading":
      return `Subiendo ${i.pending.toLocaleString("es")}`;
    case "error":
      return `Error: ${i.error ?? "no se pudo subir"}`;
    case "idle":
      return "Al día";
  }
}

/** Línea de «último archivo subido». */
export function lastText(i: SyncInfo, now: number): string | null {
  if (!i.lastFile || !i.lastAt) return null;
  return `Último: ${basename(i.lastFile) || i.lastFile} · ${agoText(i.lastAt, now)}`;
}

/** Resumen de la comparación inicial para el diálogo. */
export function previewLines(p: SyncPreview): string[] {
  const lines: string[] = [];
  lines.push(
    p.toUpload.length
      ? `${plural(p.toUpload.length, "archivo falta o es más nuevo", "archivos faltan o son más nuevos")} en tu PC (${formatBytes(p.uploadBytes)})`
      : "No hace falta subir nada: el servidor ya tiene lo de tu PC",
  );
  if (p.same) lines.push(`${plural(p.same, "archivo ya está igual", "archivos ya están iguales")} en los dos sitios`);
  if (p.remoteNewer.length)
    lines.push(`${plural(p.remoteNewer.length, "archivo es más nuevo", "archivos son más nuevos")} en el servidor: no se tocan salvo que lo marques`);
  return lines;
}

/** Texto del botón principal del diálogo. */
export function startLabel(p: SyncPreview, overwriteNewer: boolean): string {
  const n = p.toUpload.length + (overwriteNewer ? p.remoteNewer.length : 0);
  return n ? `Unir y subir ${n.toLocaleString("es")}` : "Unir carpetas";
}

/** ¿Ya hay una sincronización de esa conexión con esa carpeta del servidor? */
export function findActive(list: SyncInfo[], sessionId: string, remoteDir: string): SyncInfo | undefined {
  const norm = (p: string) => p.replace(/\/+$/, "") || "/";
  return list.find((i) => i.sessionId === sessionId && norm(i.spec.remoteDir) === norm(remoteDir));
}

/** Las dos carpetas y opciones de una sincronización guardada (sin el servidor). */
export function specOf(s: SavedSync): SyncSpec {
  return { localDir: s.localDir, remoteDir: s.remoteDir, ignore: s.ignore, deleteRemote: s.deleteRemote };
}
