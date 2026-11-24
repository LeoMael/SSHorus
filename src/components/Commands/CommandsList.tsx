// Lista agrupada de comandos y barra de importación/exportación para «Mis comandos».
import type { RefObject } from "react";
import { ClipboardCopy, ClipboardPaste, Download, Plus, Upload } from "lucide-react";
import type { Snippet } from "../../api/types";
import { CommandTags, HighlightedCommand } from "./parts";
import type { CommandItem } from "./state";
import { exportSnippets, exportSnippetsToFile } from "./transfer";

export interface CommandGroup {
  key: string;
  label: string;
  items: CommandItem[];
}

interface CommandsListProps {
  listRef: RefObject<HTMLDivElement | null>;
  groups: CommandGroup[];
  selectedId: string | null;
  showingMine: boolean;
  searching: boolean;
  query: string;
  mine: Snippet[];
  onMove: (delta: number) => void;
  onSelect: (id: string) => void;
  onOpenMenu: (x: number, y: number, item: CommandItem) => void;
  onCreateNew: () => void;
  onImportFile: () => void;
  onImportClipboard: () => void;
}

export function CommandsList({
  listRef,
  groups,
  selectedId,
  showingMine,
  searching,
  query,
  mine,
  onMove,
  onSelect,
  onOpenMenu,
  onCreateNew,
  onImportFile,
  onImportClipboard,
}: CommandsListProps) {
  return (
    <div
      className="cmd-list"
      ref={listRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onMove(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onMove(-1);
        }
      }}
    >
      {showingMine && (
        <div className="cmd-mine-bar">
          <button className="btn btn-sm" onClick={onImportFile} title="Importar desde un archivo .json (con vista previa)">
            <Upload size={13} /> Importar desde archivo…
          </button>
          <button
            className="btn btn-sm"
            onClick={onImportClipboard}
            title="Importar el JSON copiado en el portapapeles (con vista previa)"
          >
            <ClipboardPaste size={13} /> Pegar JSON
          </button>
          <button
            className="btn btn-sm"
            disabled={mine.length === 0}
            onClick={() => void exportSnippetsToFile(mine)}
            title="Guarda todos tus comandos en un archivo .json"
          >
            <Download size={13} /> Exportar a archivo…
          </button>
          <button
            className="btn btn-sm"
            disabled={mine.length === 0}
            onClick={() => void exportSnippets(mine)}
            title="Copia todos tus comandos como JSON al portapapeles"
          >
            <ClipboardCopy size={13} /> Copiar JSON
          </button>
        </div>
      )}
      {groups.length === 0 && (
        <div className="cmd-empty">
          {searching ? (
            <>No hay comandos que coincidan con «{query}».</>
          ) : showingMine ? (
            <>
              <p>Aún no tienes comandos propios para este servidor.</p>
              <button className="btn btn-primary btn-sm" onClick={onCreateNew}>
                <Plus size={13} /> Crear comando
              </button>
            </>
          ) : (
            <>Sin comandos en esta categoría.</>
          )}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.key} className="cmd-group">
          <div className="cmd-group-title">{g.label}</div>
          {g.items.map((it) => (
            <button
              key={it.id}
              data-id={it.id}
              className={`cmd-item${it.id === selectedId ? " selected" : ""}${it.dangerous ? " danger" : ""}`}
              onClick={() => onSelect(it.id)}
              onDoubleClick={() => onSelect(it.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(it.id);
                onOpenMenu(e.clientX, e.clientY, it);
              }}
              onKeyDown={(e) => {
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  onSelect(it.id);
                  onOpenMenu(r.left + 24, r.bottom, it);
                }
              }}
            >
              <span className="cmd-item-top">
                <span className="cmd-item-name">{it.name}</span>
                <CommandTags item={it} />
              </span>
              <span className="cmd-item-cmd mono">
                <HighlightedCommand text={it.command.split("\n")[0]} />
                {it.command.includes("\n") && " …"}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
