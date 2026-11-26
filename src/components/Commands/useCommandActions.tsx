// Acciones sobre un comando de la Biblioteca (editar, duplicar, eliminar, copiar, importar) y su menú contextual.
import { useState } from "react";
import { ClipboardCopy, Copy, CopyPlus, Network, Pencil, Trash2 } from "lucide-react";
import type { Snippet } from "../../api/types";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { useSnippets, type CommandItem } from "../../features/commands/state";
import { confirmDialog } from "../ui/dialogs";
import type { CommandMenuItem } from "./CommandMenu";
import { multiRunBlockedReason, runOnManyServers } from "./multi";
import { emptySnippet } from "./SnippetDialog";
import { pickImportFile, planImport, type ImportPlan } from "./transfer";

async function copyCommand(it: CommandItem) {
  try {
    await clipboard.write(it.command);
    toast.success("Comando copiado");
  } catch (e) {
    toast.error("No se pudo copiar al portapapeles", e);
  }
}

export function useCommandActions(profileId: string) {
  const removeMine = useSnippets((s) => s.remove);
  /** Comando que se está creando o editando en el diálogo. */
  const [dialog, setDialog] = useState<Snippet | null>(null);
  const [importing, setImporting] = useState<{ plan: ImportPlan; source: string } | null>(null);

  const editItem = (it: CommandItem) => it.custom && setDialog(it.custom);
  const duplicateItem = (it: CommandItem) => it.custom && setDialog({ ...it.custom, id: "", name: `${it.custom.name} (copia)` });
  const copyToMine = (it: CommandItem) =>
    setDialog({
      ...emptySnippet(),
      name: it.name,
      description: it.description ?? null,
      command: it.command,
      category: it.category,
      dangerous: it.dangerous,
      sudo: it.sudo,
      readOnly: it.readOnly,
    });
  const deleteItem = async (it: CommandItem) => {
    if (!it.custom) return;
    const ok = await confirmDialog({
      title: "¿Eliminar comando?",
      message: `Se eliminará «${it.name}» de Mis comandos.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (ok && (await removeMine(it.custom.id))) toast.success("Comando eliminado");
  };

  const importFromFile = async () => {
    try {
      const picked = await pickImportFile();
      if (picked) setImporting({ plan: planImport(picked.text), source: picked.path });
    } catch (e) {
      toast.error("No se pudo importar", e);
    }
  };
  const importFromClipboard = async () => {
    try {
      setImporting({ plan: planImport(await clipboard.read()), source: "Portapapeles" });
    } catch (e) {
      toast.error("No se pudo importar", e);
    }
  };

  const menuItems = (it: CommandItem): CommandMenuItem[] => {
    const multi = multiRunBlockedReason(it);
    const out: CommandMenuItem[] = [
      {
        label: "Ejecutar en varios servidores…",
        icon: <Network size={14} />,
        disabled: !!multi,
        onSelect: () => runOnManyServers(it, profileId),
      },
      { label: "Copiar comando", icon: <ClipboardCopy size={14} />, onSelect: () => void copyCommand(it) },
    ];
    if (it.custom) {
      out.push(
        { label: "Editar…", icon: <Pencil size={14} />, sepBefore: true, onSelect: () => editItem(it) },
        { label: "Duplicar…", icon: <CopyPlus size={14} />, onSelect: () => duplicateItem(it) },
        { label: "Eliminar", icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteItem(it) },
      );
    } else {
      out.push({ label: "Copiar a Mis comandos…", icon: <Copy size={14} />, sepBefore: true, onSelect: () => copyToMine(it) });
    }
    return out;
  };

  return {
    dialog,
    setDialog,
    importing,
    setImporting,
    editItem,
    duplicateItem,
    copyToMine,
    deleteItem,
    importFromFile,
    importFromClipboard,
    menuItems,
  };
}
