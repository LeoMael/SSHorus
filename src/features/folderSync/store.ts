// Sincronizaciones activas (las manda el motor en cada cambio) y el pedido de abrir el diálogo.
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { EV_FOLDER_SYNC, folderSync, type SyncInfo, type SyncSpec } from "../../api/folderSync";

export interface SyncDialogRequest {
  sessionId: string;
  /** Carpeta del servidor (o la del PC si se abre «al revés»), ya puesta. */
  spec: Partial<SyncSpec>;
  /** Viene de una sincronización guardada: «Recordar» marcado y comparación al abrir. */
  saved?: boolean;
}

interface FolderSyncState {
  list: SyncInfo[];
  dialog: SyncDialogRequest | null;
  openDialog: (req: SyncDialogRequest) => void;
  closeDialog: () => void;
}

export const useFolderSyncs = create<FolderSyncState>((set) => ({
  list: [],
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));

let started = false;

/** Escucha al motor (una sola vez) y carga la lista actual. */
export async function initFolderSyncs(): Promise<void> {
  if (started) return;
  started = true;
  await listen<SyncInfo[]>(EV_FOLDER_SYNC, (e) => useFolderSyncs.setState({ list: e.payload }));
  try {
    useFolderSyncs.setState({ list: await folderSync.list() });
  } catch {
    // Sin motor (p. ej. en pruebas): la lista llega con el primer evento.
  }
}
