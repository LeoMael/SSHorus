// «Sincronizar carpeta» (motor: src-tauri/src/foldersync). Tipos espejo de `foldersync/model.rs`.
import { call } from "./core";

/** Payload: `SyncInfo[]` con todas las sincronizaciones activas, tras cualquier cambio. */
export const EV_FOLDER_SYNC = "folder-sync://list";

export interface SyncSpec {
  localDir: string;
  remoteDir: string;
  /** Patrones a ignorar además de los fijos y de `.sshorusignore`. */
  ignore: string[];
  /** Borrar en el servidor lo que se borra en el PC. */
  deleteRemote: boolean;
}

export interface SavedSync extends SyncSpec {
  serverId: string;
}

export type SyncState = "idle" | "uploading" | "paused" | "waiting" | "error";

export interface SyncInfo {
  id: string;
  sessionId: string;
  spec: SyncSpec;
  state: SyncState;
  /** Archivos esperando o subiéndose. */
  pending: number;
  /** Archivos que se vigilan. */
  files: number;
  lastFile: string | null;
  /** Unix ms. */
  lastAt: number | null;
  error: string | null;
  warning: string | null;
  remembered: boolean;
}

/** Fechas en segundos Unix. */
export interface PlanItem {
  rel: string;
  size: number;
  localMtime: number;
  remoteMtime: number | null;
}

export interface SyncPreview {
  localFiles: number;
  toUpload: PlanItem[];
  uploadBytes: number;
  remoteNewer: PlanItem[];
  same: number;
  truncated: boolean;
}

export interface SyncStartOptions {
  /** Subir lo que falta o es más nuevo en el PC. */
  upload: boolean;
  /** Subir también lo que es más nuevo en el servidor. */
  overwriteNewer: boolean;
  /** Guardarla para reactivarla al volver a conectar. */
  remember: boolean;
}

export const folderSync = {
  preview: (sessionId: string, spec: SyncSpec) => call<SyncPreview>("folder_sync_preview", { sessionId, spec }),
  start: (sessionId: string, spec: SyncSpec, o: SyncStartOptions) =>
    call<SyncInfo>("folder_sync_start", { sessionId, spec, upload: o.upload, overwriteNewer: o.overwriteNewer, remember: o.remember }),
  list: () => call<SyncInfo[]>("folder_sync_list"),
  pause: (id: string, paused: boolean) => call<void>("folder_sync_pause", { id, paused }),
  remove: (id: string) => call<void>("folder_sync_remove", { id }),
  saved: (serverId: string) => call<SavedSync[]>("folder_sync_saved", { serverId }),
  forget: (serverId: string, spec: SyncSpec) => call<void>("folder_sync_forget", { serverId, spec }),
};
