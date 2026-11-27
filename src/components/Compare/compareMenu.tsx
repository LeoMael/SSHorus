// Opciones «Comparar…» del menú contextual del explorador: con un archivo, «Comparar con…» (un archivo
// de mi PC, el mismo en otra conexión abierta, otro de este servidor o una copia de seguridad que ya
// esté en la carpeta); con dos seleccionados, «Comparar los dos». Se abre en una pestaña del servidor.
import { Archive, FileSearch, GitCompare, HardDrive, Server } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { FileEntry } from "../../api/types";
import { dirname, joinPath } from "../../lib/paths";
import { useTabs } from "../../stores/tabs";
import { toast } from "../../stores/toasts";
import {
  backupCandidates,
  defaultOtherPath,
  isFileLike,
  otherSessions,
  pairFromSelection,
  remotePathProblem,
  useCompare,
  type CompareSide,
} from "../../features/compare";
import type { MenuItem } from "../ui/ContextMenu";
import { promptDialog } from "../ui/dialogs";

interface CompareMenuCtx {
  sessionId: string;
  /** Lo seleccionado en el explorador. */
  list: FileEntry[];
  /** Nombres de la carpeta actual (para encontrar copias de seguridad). */
  siblings: string[];
}

function serverName(sessionId: string): string {
  return useTabs.getState().tabs.find((t) => t.sessionId === sessionId)?.title ?? "servidor";
}

function remote(sessionId: string, path: string): CompareSide {
  return { kind: "remote", sessionId, server: serverName(sessionId), path };
}

/** Abre la comparación: `left` contra el archivo de este servidor (a la derecha, el que se edita). */
function openWith(sessionId: string, path: string, left: CompareSide) {
  useCompare.getState().open(sessionId, { left, right: remote(sessionId, path) });
}

async function askPath(title: string, label: string, initial: string): Promise<string | null> {
  const v = await promptDialog({ title, label, initial, confirmText: "Comparar", validate: remotePathProblem });
  return v?.trim() ?? null;
}

async function pickLocal(sessionId: string, path: string) {
  try {
    const res = await openDialog({ multiple: false, directory: false, title: "Comparar con un archivo de mi PC" });
    const local = Array.isArray(res) ? res[0] : res;
    if (local) openWith(sessionId, path, { kind: "local", path: local });
  } catch (e) {
    toast.error("No se pudo abrir el selector", e);
  }
}

function compareWithItems(sessionId: string, file: FileEntry, siblings: string[]): MenuItem[] {
  const others = otherSessions(useTabs.getState().tabs, sessionId);
  const backups = backupCandidates(file.name, siblings);
  const items: MenuItem[] = [
    { label: "Un archivo de mi PC…", icon: <HardDrive size={14} />, onSelect: () => void pickLocal(sessionId, file.path) },
    ...(others.length
      ? others.map<MenuItem>((t) => ({
          label: `El mismo archivo en «${t.title}»…`,
          icon: <Server size={14} />,
          onSelect: () =>
            void askPath(`Comparar con «${t.title}»`, `Ruta en ${t.title}`, defaultOtherPath("server", file.path)).then(
              (p) => p && openWith(sessionId, file.path, remote(t.sessionId, p)),
            ),
        }))
      : [{ label: "El mismo archivo en otro servidor", icon: <Server size={14} />, disabled: true, title: "Conéctate antes al otro servidor (en otra pestaña)." }]),
    {
      label: "Otro archivo de este servidor…",
      icon: <FileSearch size={14} />,
      onSelect: () =>
        void askPath("Comparar con otro archivo", "Ruta en este servidor", defaultOtherPath("here", file.path)).then(
          (p) => p && openWith(sessionId, file.path, remote(sessionId, p)),
        ),
    },
  ];
  if (backups.length) {
    items.push({ sep: true });
    for (const b of backups) {
      items.push({
        label: b.label,
        title: b.name,
        icon: <Archive size={14} />,
        onSelect: () => openWith(sessionId, file.path, remote(sessionId, joinPath(dirname(file.path), b.name))),
      });
    }
  }
  return items;
}

/** Opciones de comparar para lo seleccionado (ninguna si no hay archivos que comparar). */
export function compareMenuItems({ sessionId, list, siblings }: CompareMenuCtx): MenuItem[] {
  if (list.length === 1 && isFileLike(list[0])) {
    return [{ label: "Comparar con…", icon: <GitCompare size={15} />, submenu: compareWithItems(sessionId, list[0], siblings) }];
  }
  if (list.length === 2) {
    const pair = pairFromSelection(list);
    return [
      {
        label: "Comparar los dos",
        icon: <GitCompare size={15} />,
        disabled: !pair.ok,
        title: pair.ok ? undefined : pair.reason,
        onSelect: () => pair.ok && openWith(sessionId, pair.right, remote(sessionId, pair.left)),
      },
    ];
  }
  return [];
}
