// Menú contextual de la terminal: copiar, pegar, enviar a la IA, seleccionar todo, buscar y limpiar.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ClipboardPaste, Copy, Eraser, Search, TextSelect } from "lucide-react";
import { useShortcutText } from "../../features/shortcuts/shortcuts";

/** Dónde se abre el menú y si hay texto seleccionado. */
export interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

interface TermMenuProps extends MenuState {
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onSearch: () => void;
  /** Solo en las terminales de servidor: manda la selección al asistente de IA. */
  onSendToAi?: () => void;
}

export function TermMenu({ x, y, hasSelection, onClose, onCopy, onPaste, onSelectAll, onClear, onSearch, onSendToAi }: TermMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const copyKeys = useShortcutText("term.copy");
  const pasteKeys = useShortcutText("term.paste");
  const findKeys = useShortcutText("term.find");

  // Mantener el menú dentro de la ventana.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu term-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button role="menuitem" disabled={!hasSelection} onClick={run(onCopy)}>
        <Copy size={14} /> Copiar {copyKeys && <kbd>{copyKeys}</kbd>}
      </button>
      <button role="menuitem" onClick={run(onPaste)}>
        <ClipboardPaste size={14} /> Pegar {pasteKeys && <kbd>{pasteKeys}</kbd>}
      </button>
      {onSendToAi && (
        <button
          role="menuitem"
          disabled={!hasSelection}
          title="Pega el texto seleccionado en la pestaña del asistente de IA abierto (Claude Code, Codex, agy u OpenCode); si no hay ninguna, abre una"
          onClick={run(onSendToAi)}
        >
          <Bot size={14} /> Enviar a la IA
        </button>
      )}
      <hr />
      <button role="menuitem" onClick={run(onSelectAll)}>
        <TextSelect size={14} /> Seleccionar todo
      </button>
      <button role="menuitem" onClick={run(onSearch)}>
        <Search size={14} /> Buscar… {findKeys && <kbd>{findKeys}</kbd>}
      </button>
      <button role="menuitem" onClick={run(onClear)}>
        <Eraser size={14} /> Limpiar
      </button>
    </div>,
    document.body,
  );
}
