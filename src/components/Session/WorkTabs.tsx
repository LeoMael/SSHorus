// Pestañas del área de trabajo: vistas fijas, archivos abiertos (arrastrables) y el fantasma al despegar.
import type { MouseEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileCode2, GitCompare, X } from "lucide-react";
import { basename } from "../../lib/paths";
import { compareTitle, isCompareKey, sideLabel, useCompare } from "../../features/compare";
import { FIXED, type FixedTab } from "./fixedViews";
import type { TabDragApi } from "./useTabDrag";

interface FixedTabsProps {
  /** Cuál se marca como elegida. */
  isOn: (id: FixedTab) => boolean;
  onPick: (id: FixedTab) => void;
  paletteKeys: string;
}

export function FixedTabs({ isOn, onPick, paletteKeys }: FixedTabsProps) {
  return FIXED.map((f) => {
    const on = isOn(f.id);
    return (
      <button
        key={f.id}
        role="tab"
        aria-selected={on}
        className={on ? "sv-tab sv-tab-fixed active" : "sv-tab sv-tab-fixed"}
        onClick={() => onPick(f.id)}
        title={f.id === "commands" && paletteKeys ? `${f.title} (${paletteKeys} para la paleta)` : f.title}
      >
        {f.icon}
        <span>{f.label}</span>
      </button>
    );
  });
}

interface FileTabsProps {
  /** Archivos en orden de apertura (orden del DOM) y en el orden visible. */
  stable: string[];
  attached: string[];
  isOn: (p: string) => boolean;
  dirtySet: Set<string>;
  drag: TabDragApi;
  showFile: (path: string) => void;
  closeFile: (path: string) => void;
  openMenu: (x: number, y: number, path: string) => void;
}

export function FileTabs({ stable, attached, isOn, dirtySet, drag, showFile, closeFile, openMenu }: FileTabsProps) {
  const specs = useCompare((s) => s.specs);
  const onMiddle = (e: MouseEvent, path: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeFile(path);
    }
  };
  return stable.map((p) => {
    const on = isOn(p);
    const isDirty = dirtySet.has(p);
    // Una comparación: «a ↔ b» y, al pasar el ratón, los dos lados.
    const spec = isCompareKey(p) ? specs[p] : undefined;
    const cls = ["sv-tab", "sv-tab-file", on && "active", drag.dragPath === p && "dragging", drag.ghostPath === p && "detaching"]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={p}
        data-file-tab={p}
        role="tab"
        aria-selected={on}
        tabIndex={0}
        className={cls}
        style={{ order: attached.indexOf(p) + 1 }}
        title={spec ? `${sideLabel(spec.left)}\n↔ ${sideLabel(spec.right)}` : `${p}\nArrastra fuera de la ventana para abrirlo aparte`}
        onClick={() => showFile(p)}
        onPointerDown={(e) => drag.onPointerDown(e, p)}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onLostPointerCapture={drag.onLostCapture}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => onMiddle(e, p)}
        onContextMenu={(e) => {
          e.preventDefault();
          showFile(p);
          openMenu(e.clientX, e.clientY, p);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") showFile(p);
          else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.left, r.bottom, p);
          }
        }}
      >
        {spec ? <GitCompare size={14} className="sv-tab-icon" /> : <FileCode2 size={14} className="sv-tab-icon" />}
        <span className="sv-tab-title">{spec ? compareTitle(spec) : basename(p)}</span>
        <button
          className={isDirty ? "sv-tab-close dirty" : "sv-tab-close"}
          title={isDirty ? "Sin guardar — cerrar" : "Cerrar"}
          aria-label="Cerrar archivo"
          onClick={(e) => {
            e.stopPropagation();
            closeFile(p);
          }}
        >
          <span className="sv-dirty-dot" />
          <X size={13} />
        </button>
      </div>
    );
  });
}

/** Fantasma que sigue al cursor mientras la pestaña está fuera de la barra. */
export function TabDragGhost({ path, ghostRef }: { path: string; ghostRef: RefObject<HTMLDivElement | null> }) {
  return createPortal(
    <div className="sv-drag-ghost" ref={ghostRef} aria-hidden>
      <div className="sv-drag-ghost-tab">
        <FileCode2 size={14} />
        <span>{basename(path)}</span>
      </div>
      <div className="sv-drag-ghost-hint">
        <ExternalLink size={12} /> Suelta para abrir en otra ventana
      </div>
    </div>,
    document.body,
  );
}
