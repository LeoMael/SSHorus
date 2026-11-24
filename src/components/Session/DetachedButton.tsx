// Indicador de archivos abiertos en ventanas aparte, con menú para enfocarlas o traerlos de vuelta.
import { useCallback, useState } from "react";
import { CornerDownLeft, ExternalLink } from "lucide-react";
import { basename } from "../../lib/paths";
import { focusEditorWindow, requestReturn } from "../Editor/editorWindows";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";

export function DetachedButton({ sessionId, paths }: { sessionId: string; paths: string[] }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  if (paths.length === 0) return null;
  const items: MenuItem[] = [];
  paths.forEach((p, i) => {
    if (i > 0) items.push({ sep: true });
    const name = basename(p);
    items.push(
      { label: `Ir a «${name}»`, icon: <ExternalLink size={14} />, onSelect: () => void focusEditorWindow(sessionId, p) },
      { label: `Traer «${name}» aquí`, icon: <CornerDownLeft size={14} />, onSelect: () => void requestReturn(sessionId, p) },
    );
  });
  return (
    <>
      <button
        className="sv-detached"
        title={`Abierto en otra ventana: ${paths.join(", ")}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 2 });
        }}
      >
        <ExternalLink size={13} />
        <span>{paths.length === 1 ? basename(paths[0]) : `${paths.length} archivos`}</span>
        <span className="sv-detached-hint">en otra ventana</span>
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
    </>
  );
}
