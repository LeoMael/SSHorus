// Opciones del menú contextual: sobre el vacío de la carpeta o sobre lo seleccionado.
import {
  ClipboardCopy,
  Download,
  FilePlus,
  FolderDown,
  FolderOpen,
  FolderPlus,
  FolderUp,
  KeyRound,
  Pencil,
  RefreshCw,
  SquarePen,
  Trash2,
  Upload,
} from "lucide-react";
import type { FileEntry } from "../../api/types";
import type { MenuItem } from "../ui/ContextMenu";
import { isDirLike } from "../../features/fileExplorer/explorerLogic";
import { addToProjectItem } from "./projectMenu";
import type { FileActions } from "./useFileActions";

interface MenuCtx {
  onEntry: boolean;
  selectedEntries: FileEntry[];
  cwd: string | null;
  serverId: string | null;
  actions: FileActions;
  refresh: () => void;
  setPermsFor: (list: FileEntry[]) => void;
  /** «Comparar con…» / «Comparar los dos» (components/Compare). */
  compareItems: MenuItem[];
  /** «Sincronizar con una carpeta de mi PC…» (components/FolderSync). */
  syncItems: MenuItem[];
}

export function explorerMenuItems({ onEntry, selectedEntries, cwd, serverId, actions: a, refresh, setPermsFor, compareItems, syncItems }: MenuCtx): MenuItem[] {
  if (!onEntry || !selectedEntries.length) {
    return [
      { label: "Nueva carpeta", icon: <FolderPlus size={15} />, onSelect: () => a.createItem("dir") },
      { label: "Nuevo archivo", icon: <FilePlus size={15} />, onSelect: () => a.createItem("file") },
      { sep: true },
      { label: "Subir archivos…", icon: <Upload size={15} />, onSelect: () => a.pickAndUpload(false) },
      { label: "Subir carpeta…", icon: <FolderUp size={15} />, onSelect: () => a.pickAndUpload(true) },
      ...syncItems,
      { sep: true },
      { label: "Copiar ruta", icon: <ClipboardCopy size={15} />, disabled: !cwd, onSelect: () => cwd && a.copyPaths([cwd]) },
      { label: "Refrescar", icon: <RefreshCw size={15} />, hint: "F5", onSelect: () => refresh() },
    ];
  }
  const list = selectedEntries;
  const single = list.length === 1 ? list[0] : null;
  const singleDir = single ? isDirLike(single) : false;
  return [
    {
      label: singleDir ? "Abrir" : "Editar",
      icon: singleDir ? <FolderOpen size={15} /> : <SquarePen size={15} />,
      hint: "Intro",
      disabled: !single || single.kind === "other",
      onSelect: () => single && a.openEntry(single),
    },
    { label: "Descargar en…", icon: <Download size={15} />, onSelect: () => a.download(list) },
    {
      label: "Descargar y abrir carpeta",
      icon: <FolderDown size={15} />,
      onSelect: () => a.download(list, true),
    },
    ...(compareItems.length ? [{ sep: true } as const, ...compareItems] : []),
    { sep: true },
    { label: "Renombrar", icon: <Pencil size={15} />, hint: "F2", disabled: !single, onSelect: () => single && a.rename(single) },
    { label: "Permisos…", icon: <KeyRound size={15} />, onSelect: () => setPermsFor(list) },
    { label: list.length > 1 ? "Copiar rutas" : "Copiar ruta", icon: <ClipboardCopy size={15} />, onSelect: () => a.copyPaths(list.map((e) => e.path)) },
    ...(single && singleDir ? [addToProjectItem(serverId, single.path)] : []),
    ...syncItems,
    { sep: true },
    { label: "Eliminar", icon: <Trash2 size={15} />, hint: "Supr", danger: true, onSelect: () => a.remove(list) },
  ];
}
