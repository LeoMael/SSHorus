// Acciones sobre archivos: abrir, subir, descargar, crear, renombrar, borrar, permisos y copiar rutas.
import type { RefObject } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { sftp } from "../../api/sftp";
import { transfers } from "../../api/transfers";
import { errorMessage } from "../../api/core";
import type { FileEntry } from "../../api/types";
import { clipboard } from "../../lib/clipboard";
import { dirname, joinPath } from "../../lib/paths";
import { localBasename } from "../../lib/platform";
import { toast } from "../../stores/toasts";
import { confirmDialog, promptDialog } from "../ui/dialogs";
import { itemsLabel, validateName } from "./explorerLogic";
import { isDirLike } from "./icons";
import { revealWhenDone, systemDownloadDir } from "./revealDownload";
import type { LoadOpts } from "./useDirectory";
import { useEvent } from "./useEvent";

interface ActionsOpts {
  sessionId: string;
  cwdRef: RefObject<string | null>;
  load: (path: string, opts?: LoadOpts) => Promise<void>;
  refresh: () => void;
  onOpenFile: (path: string) => void;
  /** Devuelve el foco a la lista (tras un diálogo). */
  focusRoot: () => void;
  confirmDelete: boolean;
  setPermsFor: (list: FileEntry[] | null) => void;
}

export type FileActions = ReturnType<typeof useFileActions>;

export function useFileActions({ sessionId, cwdRef, load, refresh, onOpenFile, focusRoot, confirmDelete, setPermsFor }: ActionsOpts) {
  const openEntry = useEvent((e: FileEntry) => {
    if (isDirLike(e)) load(e.path);
    else if (e.kind === "other") toast.info("No se puede abrir este elemento", "Solo se abren archivos y carpetas.");
    else onOpenFile(e.path);
  });

  const startUpload = useEvent(async (paths: string[], dir: string | null) => {
    if (!paths.length || !dir) return;
    try {
      await transfers.upload(sessionId, paths, dir);
      // Rutas locales: pueden venir con "\" y letra de unidad (Windows).
      toast.info(`Subiendo ${itemsLabel(paths.length, localBasename(paths[0]))}…`, `a ${dir}`);
    } catch (err) {
      toast.error("No se pudo iniciar la subida", err);
    }
  });

  const pickAndUpload = useEvent(async (folders: boolean) => {
    const dir = cwdRef.current;
    if (!dir) return;
    try {
      const res = await openDialog({ multiple: true, directory: folders, title: folders ? "Subir carpetas" : "Subir archivos" });
      const paths = res == null ? [] : Array.isArray(res) ? res : [res];
      await startUpload(paths, dir);
    } catch (err) {
      toast.error("No se pudo abrir el selector", err);
    }
    focusRoot();
  });

  /** "Descargar en…" (elige carpeta) o, con `reveal`, "Descargar y abrir carpeta": baja a
   *  Descargas y al terminar abre el gestor de archivos con lo descargado seleccionado. */
  const download = useEvent(async (list: FileEntry[], reveal = false) => {
    if (!list.length) return;
    try {
      let dir: string | null = reveal ? await systemDownloadDir() : null;
      if (!dir) {
        const res = await openDialog({ directory: true, multiple: false, title: "Descargar en…" });
        dir = (Array.isArray(res) ? res[0] : res) ?? null;
      }
      if (!dir) return;
      // `dir` es una ruta LOCAL (en Windows "C:\Users\…"): se pasa tal cual al motor, sin unirle "/".
      const batchId = await transfers.download(sessionId, list.map((e) => e.path), dir);
      if (reveal) revealWhenDone(batchId, dir, list);
      const what = itemsLabel(list.length, list[0].name);
      toast.info(`Descargando ${what}…`, reveal ? `a ${dir}; al terminar se abrirá la carpeta` : `a ${dir}`);
    } catch (err) {
      toast.error("No se pudo iniciar la descarga", err);
    } finally {
      focusRoot();
    }
  });

  const createItem = useEvent(async (kind: "dir" | "file") => {
    const dir = cwdRef.current;
    if (!dir) return;
    const isDir = kind === "dir";
    const name = await promptDialog({
      title: isDir ? "Nueva carpeta" : "Nuevo archivo",
      label: "Nombre",
      placeholder: isDir ? "nueva-carpeta" : "archivo.txt",
      confirmText: "Crear",
      validate: validateName,
    });
    focusRoot();
    if (name == null) return;
    const path = joinPath(dir, name.trim());
    try {
      if (isDir) await sftp.mkdir(sessionId, path);
      else await sftp.createFile(sessionId, path);
      await load(dir, { history: "none", select: path });
      if (!isDir) onOpenFile(path);
    } catch (err) {
      toast.error(isDir ? "No se pudo crear la carpeta" : "No se pudo crear el archivo", err);
    }
  });

  const rename = useEvent(async (e: FileEntry) => {
    const name = await promptDialog({
      title: "Renombrar",
      label: "Nuevo nombre",
      initial: e.name,
      selectBaseName: !isDirLike(e),
      confirmText: "Renombrar",
      validate: validateName,
    });
    focusRoot();
    if (name == null || name.trim() === e.name) return;
    const to = joinPath(dirname(e.path), name.trim());
    try {
      await sftp.rename(sessionId, e.path, to);
      await load(dirname(e.path), { history: "none", select: to });
    } catch (err) {
      toast.error(`No se pudo renombrar «${e.name}»`, err);
    }
  });

  const remove = useEvent(async (list: FileEntry[]) => {
    if (!list.length) return;
    if (confirmDelete) {
      const hasDir = list.some((e) => e.kind === "dir");
      const shown = list.slice(0, 6);
      const ok = await confirmDialog({
        title: list.length === 1 ? `¿Eliminar «${list[0].name}»?` : `¿Eliminar ${list.length} elementos?`,
        message: (
          <>
            {list.length > 1 && (
              <ul className="fx-del-list">
                {shown.map((e) => (
                  <li key={e.path}>{e.name}</li>
                ))}
                {list.length > shown.length && <li className="faint">y {list.length - shown.length} más…</li>}
              </ul>
            )}
            {hasDir && <div>Las carpetas se borran con todo su contenido.</div>}
            <div>Esta acción no se puede deshacer.</div>
          </>
        ),
        confirmText: "Eliminar",
        danger: true,
      });
      focusRoot();
      if (!ok) return;
    }
    try {
      await sftp.delete(sessionId, list.map((e) => e.path));
    } catch (err) {
      toast.error("No se pudo eliminar", err);
    }
    refresh();
  });

  const applyPerms = useEvent(async (list: FileEntry[], mode: number) => {
    setPermsFor(null);
    focusRoot();
    const failed: string[] = [];
    let lastErr: unknown;
    for (const e of list) {
      try {
        await sftp.chmod(sessionId, e.path, mode);
      } catch (err) {
        failed.push(e.name);
        lastErr = err;
      }
    }
    if (failed.length === 1) toast.error(`No se pudieron cambiar los permisos de «${failed[0]}»`, lastErr);
    else if (failed.length > 1) toast.error(`No se pudieron cambiar los permisos de ${failed.length} elementos`, lastErr);
    refresh();
  });

  const copyPaths = useEvent(async (paths: string[]) => {
    if (!paths.length) return;
    try {
      await clipboard.write(paths.join("\n"));
      toast.success(paths.length === 1 ? "Ruta copiada" : `${paths.length} rutas copiadas`);
    } catch (err) {
      toast.error("No se pudo copiar al portapapeles", errorMessage(err));
    }
  });

  return { openEntry, startUpload, pickAndUpload, download, createItem, rename, remove, applyPerms, copyPaths };
}
