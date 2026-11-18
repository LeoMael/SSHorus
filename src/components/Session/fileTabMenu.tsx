// Menú contextual de la pestaña de un archivo.
import { Columns2, Copy, ExternalLink, PanelTop, X } from "lucide-react";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import type { MenuItem } from "../FileExplorer/ContextMenu";
import type { FixedTab } from "./fixedViews";

interface FileTabMenuCtx {
  path: string;
  connected: boolean;
  split: boolean;
  side: FixedTab;
  /** Atajo de «Dividir» (se muestra junto a la opción que haría lo mismo). */
  splitHint: string | undefined;
  detachFile: (path: string) => void;
  unsplit: () => void;
  splitWith: (id: FixedTab, path: string) => void;
  closeFile: (path: string) => void;
}

/** Vistas con las que se ofrece dividir desde la pestaña de un archivo. */
const SPLIT_WITH: { id: FixedTab; label: string }[] = [
  { id: "files", label: "Dividir con Archivos" },
  { id: "commands", label: "Dividir con Comandos" },
];

export function fileTabMenuItems({ path, connected, split, side, splitHint, detachFile, unsplit, splitWith, closeFile }: FileTabMenuCtx): MenuItem[] {
  return [
    {
      label: "Abrir en ventana aparte",
      icon: <ExternalLink size={14} />,
      disabled: !connected,
      onSelect: () => detachFile(path),
    },
    { sep: true },
    ...(split
      ? [{ label: "Quitar división", icon: <PanelTop size={14} />, hint: splitHint, onSelect: unsplit }]
      : SPLIT_WITH.map((v) => ({
          label: v.label,
          icon: <Columns2 size={14} />,
          hint: side === v.id ? splitHint : undefined,
          onSelect: () => splitWith(v.id, path),
        }))),
    { sep: true },
    {
      label: "Copiar ruta",
      icon: <Copy size={14} />,
      onSelect: () => {
        clipboard.write(path).then(
          () => toast.success("Ruta copiada"),
          (e: unknown) => toast.error("No se pudo copiar", e),
        );
      },
    },
    { sep: true },
    { label: "Cerrar", icon: <X size={14} />, onSelect: () => closeFile(path) },
  ];
}
