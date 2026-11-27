// Leer un lado de la comparación: por SFTP (con la conexión de ese servidor) o del disco de este equipo.
import { sftp } from "../../api/sftp";
import { localfs } from "../../api/localfs";
import { errorMessage, isApiError } from "../../api/core";
import { formatBytes } from "../../lib/format";
import { looksBinary, sizeProblem, type CompareSide, type SideText } from "./model";

const NOT_TEXT = "No es un archivo de texto (parece binario): no se puede comparar.";

async function readRemote(sessionId: string, path: string): Promise<SideText> {
  let size: number;
  try {
    const st = await sftp.stat(sessionId, path);
    if (st.kind === "dir" || st.isDirLink) return { state: "blocked", reason: "Es una carpeta, no un archivo." };
    size = st.size;
  } catch (e) {
    if (isApiError(e, "NotFound")) return { state: "missing" };
    throw e;
  }
  const big = sizeProblem(size);
  if (big) return { state: "blocked", reason: big };
  try {
    const t = await sftp.readText(sessionId, path);
    return { state: "ok", content: t.content, modified: t.modified };
  } catch (e) {
    if (isApiError(e, "NotFound")) return { state: "missing" };
    if (isApiError(e, "FileTooLarge")) {
      return { state: "blocked", reason: `Pasa del límite del editor (${formatBytes(size)}); puedes subirlo en Ajustes → Editor.` };
    }
    if (isApiError(e, "Invalid")) return { state: "blocked", reason: NOT_TEXT };
    throw e;
  }
}

async function readLocal(path: string): Promise<SideText> {
  try {
    const content = await localfs.readText(path);
    if (looksBinary(content)) return { state: "blocked", reason: NOT_TEXT };
    return { state: "ok", content, modified: null };
  } catch (e) {
    if (isApiError(e, "NotFound")) return { state: "missing" };
    // El motor ya explica el motivo (carpeta, demasiado grande o no es texto UTF-8).
    if (isApiError(e, "Invalid")) return { state: "blocked", reason: errorMessage(e) };
    throw e;
  }
}

/** Lee un lado. Los errores de conexión o permisos se lanzan (la vista los enseña con «Reintentar»). */
export function readSide(side: CompareSide): Promise<SideText> {
  return side.kind === "remote" ? readRemote(side.sessionId, side.path) : readLocal(side.path);
}
