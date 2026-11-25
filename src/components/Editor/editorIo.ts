// Cómo lee y guarda el editor: por SFTP con tu usuario (lo normal) o de otra forma, p. ej. como el
// dueño de un proyecto de Contenedores (con sudo), que da su propio `EditorIo`.
import { sftp } from "../../api/sftp";
import { isApiError } from "../../api/core";

export interface EditorIo {
  read: () => Promise<{ content: string; size: number; modified: number | null }>;
  /** Si existe y su fecha de modificación (para avisar si cambió desde que se abrió). */
  remoteState: () => Promise<{ exists: boolean; modified: number | null }>;
  write: (content: string) => Promise<{ size: number; modified: number | null }>;
}

export function sftpIo(sessionId: string, path: string): EditorIo {
  return {
    read: () => sftp.readText(sessionId, path),
    remoteState: async () => {
      try {
        const st = await sftp.stat(sessionId, path);
        return { exists: true, modified: st.modified };
      } catch (e) {
        if (isApiError(e, "NotFound")) return { exists: false, modified: null };
        throw e;
      }
    },
    write: (content) => sftp.writeText(sessionId, path, content),
  };
}
