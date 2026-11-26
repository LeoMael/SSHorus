// Menú contextual de una sub-pestaña de terminal: nueva, sesiones del servidor, desacoplar, copiar el
// comando para engancharse y cerrar.
import { Copy, LayersIcon, Plus, Unlink, X } from "lucide-react";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { manualAttachCommand } from "../../features/tmux/logic";
import type { MenuItem } from "../ui/ContextMenu";
import type { SubTab } from "./subTabs";

interface Actions {
  /** Sin conexión: no se abren terminales nuevas. */
  blocked: boolean;
  onNew: () => void;
  onSessions: () => void;
  /** `detach`: la sesión tmux sigue en el servidor. */
  onClose: (detach: boolean) => void;
}

export function termTabMenuItems(t: SubTab | undefined, a: Actions): MenuItem[] {
  if (!t) return [];
  const items: MenuItem[] = [
    { label: "Nueva terminal", icon: <Plus size={14} />, disabled: a.blocked, onSelect: a.onNew },
    {
      label: "Terminales persistentes en el servidor…",
      icon: <LayersIcon size={14} />,
      disabled: a.blocked,
      onSelect: a.onSessions,
    },
    { sep: true },
  ];
  if (t.persistent && t.tmux) {
    const name = t.tmux;
    items.push(
      {
        label: "Desacoplar (sigue corriendo en el servidor)",
        icon: <Unlink size={14} />,
        onSelect: () => a.onClose(true),
      },
      {
        label: "Copiar comando para engancharse",
        icon: <Copy size={14} />,
        hint: name,
        onSelect: () => {
          clipboard.write(manualAttachCommand(name)).catch((e) => toast.error("No se pudo copiar", e));
        },
      },
    );
  }
  items.push({
    label: t.persistent ? "Cerrar y terminar la sesión" : "Cerrar terminal",
    icon: <X size={14} />,
    danger: t.persistent,
    onSelect: () => a.onClose(false),
  
  });
  return items;
}
