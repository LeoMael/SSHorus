// Botón «Asistente con contexto» de la barra de una terminal local: abre un asistente en esa misma
// terminal (inplace.ts) o copia el contexto de SSHorus.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ChevronDown, ClipboardCopy } from "lucide-react";
import { PopupMenu } from "../../components/ui/PopupMenu";
import { copyContextHere, launchHere } from "./inplace";
import { ASSISTANTS, assistantNames } from "./logic";
import type { LocalTab } from "./store";

export function HereMenu({ tab }: { tab: LocalTab }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Con un asistente ya abierto en la pestaña no tiene sentido abrir otro encima.
  if (tab.aiAlive) return null;
  const ready = tab.status === "running";

  const run = (fn: () => Promise<void>) => () => {
    setAt(null);
    void fn();
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-sm lt-here-btn"
        disabled={!ready}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        title={
          ready
            ? `Abre ${assistantNames("o")} en esta terminal, con el contexto de SSHorus y su MCP`
            : "Abre primero la shell (pulsa Enter en la terminal)"
        }
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Bot size={13} /> Asistente con contexto <ChevronDown size={12} />
      </button>
      {at &&
        createPortal(
          <PopupMenu x={at.x} y={at.y} onClose={() => setAt(null)} minWidth={240}>
            {ASSISTANTS.map((a) => (
              <button
                key={a.tool}
                role="menuitem"
                title={`Abre ${a.label} aquí, en la carpeta actual de la shell. Al salir, vuelves a la shell.${a.limits ? ` ${a.limits}` : ""}`}
                onClick={run(() => launchHere(tab.id, a.tool))}
              >
                <Bot size={14} /> {a.label} {a.limitsTag && <span className="lt-menu-hint">{a.limitsTag}</span>}
              </button>
            ))}
            <hr />
            <button
              role="menuitem"
              title="Copia el contexto de SSHorus para pegarlo en un asistente que abriste tú (sin contraseñas, llaves ni tokens)"
              onClick={run(() => copyContextHere(tab.id))}
            >
              <ClipboardCopy size={14} /> Copiar contexto
            </button>
          </PopupMenu>,
          document.body,
        )}
    </>
  );
}
