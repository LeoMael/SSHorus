// Guardar el lado derecho de una comparación con la misma interfaz que el editor (`EditorIo`):
// por SFTP en su servidor o en el disco de este equipo.
import { localfs } from "../../api/localfs";
import { isApiError } from "../../api/core";
import type { CompareSide } from "../../features/compare";
import { sftpIo, type EditorIo } from "../Editor/editorIo";

function localIo(path: string): EditorIo {
  return {
    read: async () => {
      const content = await localfs.readText(path);
      return { content, size: content.length, modified: null };
    },
    // Sin fecha de modificación de los archivos locales: solo se sabe si existe.
    remoteState: async () => {
      try {
        await localfs.readText(path);
        return { exists: true, modified: null };
      } catch (e) {
        if (isApiError(e, "NotFound")) return { exists: false, modified: null };
        throw e;
      }
    },
    write: async (content) => {
      await localfs.writeText(path, content);
      return { size: content.length, modified: null };
    },
  };
}

export function sideIo(side: CompareSide): EditorIo {
  return side.kind === "remote" ? sftpIo(side.sessionId, side.path) : localIo(side.path);
}
