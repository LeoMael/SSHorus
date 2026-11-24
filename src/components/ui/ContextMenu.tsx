// Menú contextual flotante (usa la clase .context-menu del tema), con submenús y teclado.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export type MenuItem =
  | { sep: true }
  | {
      sep?: false;
      label: string;
      icon?: ReactNode;
      hint?: string;
      /** Texto al pasar el ratón (p. ej. por qué está desactivado). */
      title?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Con submenú, `onSelect` no se usa: al elegir se abre el submenú. */
      submenu?: MenuItem[];
      onSelect?: () => void;
    };

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Ancho aproximado de un submenú, para decidir si se abre a la derecha o a la izquierda. */
const SUB_W = 220;

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".fx-menu")) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [onClose]);

  return createPortal(<MenuPanel x={x} y={y} items={items} onClose={onClose} autoFocus />, document.body);
}

function MenuPanel({
  x,
  y,
  items,
  onClose,
  autoFocus,
  onBack,
}: Props & { autoFocus?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<{ index: number; x: number; y: number; focus: boolean } | null>(null);

  // Mantiene el menú dentro de la ventana.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    setPos({ left, top });
    if (autoFocus) el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y, autoFocus]);

  const openSubmenu = (index: number, btn: HTMLElement, focus: boolean) => {
    const r = btn.getBoundingClientRect();
    const right = r.right + 2;
    // Si no cabe a la derecha, se abre a la izquierda del menú.
    const sx = right + SUB_W > window.innerWidth ? Math.max(4, r.left - SUB_W - 2) : right;
    setOpenSub({ index, x: sx, y: r.top - 4, focus });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // El menú vive en un portal, pero los eventos de React siguen subiendo al explorador.
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "ArrowLeft" && onBack)) {
      e.preventDefault();
      if (onBack) onBack();
      else onClose();
      return;
    }
    if (e.key === "ArrowRight") {
      const btn = document.activeElement as HTMLButtonElement | null;
      const idx = btn?.dataset.index ? Number(btn.dataset.index) : -1;
      const it = items[idx];
      if (btn && it && !it.sep && it.submenu && !it.disabled) {
        e.preventDefault();
        openSubmenu(idx, btn, true);
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)") ?? []);
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[next].focus();
  };

  const sub = openSub ? items[openSub.index] : undefined;

  return (
    <>
      <div
        ref={ref}
        className="context-menu fx-menu"
        style={{ left: pos.left, top: pos.top }}
        role="menu"
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.sep ? (
            <hr key={`sep-${i}`} />
          ) : (
            <button
              key={`${it.label}-${i}`}
              role="menuitem"
              data-index={i}
              className={it.danger ? "danger" : undefined}
              disabled={it.disabled}
              title={it.title}
              aria-haspopup={it.submenu ? "menu" : undefined}
              aria-expanded={it.submenu ? openSub?.index === i : undefined}
              onMouseEnter={(e) => {
                if (it.submenu) openSubmenu(i, e.currentTarget, false);
                else if (openSub) setOpenSub(null);
              }}
              onClick={(e) => {
                if (it.submenu) {
                  openSubmenu(i, e.currentTarget, true);
                  return;
                }
                onClose();
                it.onSelect?.();
              }}
            >
              <span className="fx-menu-icon">{it.icon}</span>
              <span className="fx-menu-label">{it.label}</span>
              {it.hint && <span className="fx-menu-hint">{it.hint}</span>}
              {it.submenu && <ChevronRight size={14} className="fx-menu-chevron" />}
            </button>
          ),
        )}
      </div>
      {openSub && sub && !sub.sep && sub.submenu && (
        <MenuPanel
          key={openSub.index}
          x={openSub.x}
          y={openSub.y}
          items={sub.submenu}
          onClose={onClose}
          autoFocus={openSub.focus}
          onBack={() => {
            const idx = openSub.index;
            setOpenSub(null);
            ref.current?.querySelector<HTMLButtonElement>(`button[data-index="${idx}"]`)?.focus();
          }}
        />
      )}
    </>
  );
}
