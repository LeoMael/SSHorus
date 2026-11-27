// Entrada «Sincronizar con una carpeta de mi PC…» del menú del explorador: sobre una carpeta
// seleccionada o sobre el vacío de la carpeta abierta. Si ya está unida, lo dice.
import { FolderSync } from "lucide-react";
import type { FileEntry } from "../../api/types";
import { isDirLike } from "../../features/fileExplorer/explorerLogic";
import { findActive, syncLabel, useFolderSyncs } from "../../features/folderSync";
import type { MenuItem } from "../ui/ContextMenu";

interface SyncMenuCtx {
  sessionId: string;
  /** Lo seleccionado (vacío = menú sobre el vacío de la carpeta). */
  list: FileEntry[];
  cwd: string | null;
}

export function syncMenuItems({ sessionId, list, cwd }: SyncMenuCtx): MenuItem[] {
  const target = list.length === 0 ? cwd : list.length === 1 && isDirLike(list[0]) ? list[0].path : null;
  if (!target || target === "/") return [];
  const st = useFolderSyncs.getState();
  const active = findActive(st.list, sessionId, target);
  if (active) {
    return [{ label: "Ya sincronizada con tu PC", icon: <FolderSync size={15} />, disabled: true, title: syncLabel(active.spec) }];
  }
  return [
    {
      label: "Sincronizar con una carpeta de mi PC…",
      icon: <FolderSync size={15} />,
      title: "Lo que guardes en esa carpeta de tu PC se subirá solo aquí",
      onSelect: () => st.openDialog({ sessionId, spec: { remoteDir: target } }),
    },
  ];
}
