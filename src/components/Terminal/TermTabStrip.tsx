// Tira de sub-pestañas de terminal: una por shell, con su icono de persistente (tmux) y su «×».
// Teclado: Enter/Espacio la elige, flechas para moverse y Supr la cierra. Clic central también cierra.
import { InfinityIcon, SquareTerminal, X } from "lucide-react";
import type { SubTab } from "./subTabs";

interface Props {
  tabs: SubTab[];
  activeKey: number | null;
  onActivate: (key: number) => void;
  onClose: (key: number) => void;
  /** Menú contextual de una sub-pestaña. */
  onMenu: (x: number, y: number, key: number) => void;
}

export function TermTabStrip({ tabs, activeKey, onActivate, onClose, onMenu }: Props) {
  const onTabKey = (e: React.KeyboardEvent, key: number) => {
    const idx = tabs.findIndex((t) => t.key === key);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate(key);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = tabs[(idx + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (n) {
        onActivate(n.key);
        (e.currentTarget.parentElement?.children[tabs.indexOf(n)] as HTMLElement | undefined)?.focus();
      }
    } else if (e.key === "Delete") {
      e.preventDefault();
      onClose(key);
    }
  };

  return (
    <div className="term-tabs" role="tablist" aria-label="Terminales">
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tab"
          tabIndex={t.key === activeKey ? 0 : -1}
          aria-selected={t.key === activeKey}
          className={`term-tab${t.key === activeKey ? " active" : ""}${t.status === "exited" ? " exited" : ""}`}
          title={t.status === "exited" ? "Shell terminada" : undefined}
          onClick={() => onActivate(t.key)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(t.key);
            }
          }}
          onKeyDown={(e) => onTabKey(e, t.key)}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu(e.clientX, e.clientY, t.key);
          }}
        >
          <SquareTerminal size={13} className="term-tab-icon" />
          <span className="term-tab-label">Terminal {t.num}</span>
          {t.persistent && (
            <span
              className="term-tab-persist"
              title={`Terminal persistente (tmux «${t.tmux}»): sigue viva en el servidor si se corta la conexión`}
              aria-label="Persistente"
            >
              <InfinityIcon size={12} />
            </span>
          )}
          <button
            type="button"
            className="term-tab-close"
            tabIndex={-1}
            aria-label={`Cerrar Terminal ${t.num}`}
            title={t.persistent ? "Cerrar terminal (termina su sesión tmux)" : "Cerrar terminal"}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.key);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
