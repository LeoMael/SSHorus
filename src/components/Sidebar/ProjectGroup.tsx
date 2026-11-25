// Proyecto en la barra lateral: cabecera plegable con sus servidores y marcadores debajo.
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { ServerItems } from "./MachineGroup";
import { bookmarkRowKey, type ProjectEntry } from "./sidebarLogic";
import { BookmarkRow, type RowApi } from "./SidebarRows";

interface Props {
  api: RowApi;
  entry: ProjectEntry;
  /** Búsqueda activa (en minúsculas): con ella todos los proyectos se ven desplegados. */
  q: string;
  collapsed: boolean;
  toggleProject: (id: string, force?: boolean) => void;
}

export function ProjectGroup({ api, entry, q, collapsed, toggleProject }: Props) {
  const { tree, menus } = api;
  const { project: p } = entry;
  const key = `p:${p.id}`;
  const open = q ? true : !collapsed;
  const selected = tree.selected === key;
  return (
    <div role="group">
      <div
        data-sb-row
        tabIndex={0}
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        className={`sb-row sb-project${selected ? " selected" : ""}`}
        onClick={() => {
          tree.setSelected(key);
          toggleProject(p.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            toggleProject(p.id, true);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            toggleProject(p.id, false);
          } else tree.rowKeys(e, () => toggleProject(p.id), key, () => menus.project(p));
        }}
        onContextMenu={(e) => tree.openMenuAt(e, key, menus.project(p))}
      >
        <span className="sb-lead">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="sb-chip" style={{ background: p.color ?? undefined }} />
        <span className="sb-name sb-project-name">{p.name}</span>
        <button
          type="button"
          className="icon-btn sb-row-btn"
          title="Añadir un servidor a este proyecto"
          aria-label={`Añadir servidor a ${p.name}`}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            tree.setSelected(key);
            tree.openMenuForElement(e.currentTarget, key, menus.addToProject(p));
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Plus size={13} />
        </button>
        <span className="sb-count">{p.serverIds.length}</span>
      </div>
      {open && (
        <>
          <ServerItems api={api} servers={entry.servers} projectId={p.id} q={q} />
          {entry.bookmarks.map((b) => (
            <BookmarkRow key={bookmarkRowKey(p.id, b)} api={api} p={p} b={b} />
          ))}
          {entry.servers.length === 0 && entry.bookmarks.length === 0 && (
            <div className="sb-row sb-indent sb-placeholder">
              {q ? (
                "Sin servidores"
              ) : (
                <>
                  Sin servidores ·{" "}
                  <button
                    type="button"
                    className="sb-linkbtn"
                    onClick={(e) => tree.openMenuForElement(e.currentTarget, key, menus.addToProject(p))}
                  >
                    Añadir
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
