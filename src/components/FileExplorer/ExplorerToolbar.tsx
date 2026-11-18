// Barras de arriba del explorador: navegación, ruta y filtro; debajo, subir/descargar/crear.
import type { RefObject } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Download, Eye, EyeOff, FilePlus, FolderPlus, FolderUp, House, RefreshCw, Search, Upload, X } from "lucide-react";
import { Breadcrumb } from "./Breadcrumb";

interface ToolbarProps {
  offline: boolean;
  cwd: string | null;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  shownPath: string;
  editingPath: boolean;
  onEditingChange: (v: boolean) => void;
  onNavigate: (p: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  refresh: () => void;
  goHome: () => void;
  filter: string;
  setFilter: (v: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
}

export function ExplorerToolbar(p: ToolbarProps) {
  const { offline, cwd } = p;
  return (
    <div className="fx-toolbar">
      <div className="fx-nav">
        <button className="icon-btn" onClick={p.goBack} disabled={offline || !p.canBack} title="Atrás (Alt+←)" aria-label="Atrás">
          <ArrowLeft size={15} />
        </button>
        <button className="icon-btn" onClick={p.goForward} disabled={offline || !p.canForward} title="Adelante (Alt+→)" aria-label="Adelante">
          <ArrowRight size={15} />
        </button>
        <button className="icon-btn" onClick={p.goUp} disabled={offline || !cwd || cwd === "/"} title="Carpeta superior (Alt+↑)" aria-label="Subir un nivel">
          <ArrowUp size={15} />
        </button>
        <button className="icon-btn" onClick={p.refresh} disabled={offline} title="Refrescar (F5)" aria-label="Refrescar">
          <RefreshCw size={15} className={p.loading ? "fx-spin" : undefined} />
        </button>
        <button className="icon-btn" onClick={p.goHome} disabled={offline} title="Carpeta de inicio" aria-label="Inicio">
          <House size={15} />
        </button>
      </div>
      <div className="fx-path">
        <Breadcrumb path={p.shownPath} editing={p.editingPath && !offline} onEditingChange={p.onEditingChange} onNavigate={p.onNavigate} />
      </div>
      <div className="fx-filter">
        <Search size={13} className="fx-filter-icon" />
        <input
          ref={p.filterRef}
          className="input"
          value={p.filter}
          placeholder="Filtrar"
          spellCheck={false}
          aria-label="Filtrar por nombre"
          onChange={(e) => p.setFilter(e.target.value)}
        />
        {p.filter && (
          <button className="fx-filter-clear" onClick={() => p.setFilter("")} aria-label="Limpiar filtro" tabIndex={-1}>
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

interface ActionsProps {
  offline: boolean;
  cwd: string | null;
  hasSelection: boolean;
  showHidden: boolean;
  onToggleHidden: () => void;
  onUpload: (folders: boolean) => void;
  onDownload: () => void;
  onCreate: (kind: "dir" | "file") => void;
}

export function ExplorerActions({ offline, cwd, hasSelection, showHidden, onToggleHidden, onUpload, onDownload, onCreate }: ActionsProps) {
  return (
    <div className="fx-actions">
      <button className="btn btn-sm btn-accent" onClick={() => onUpload(false)} disabled={offline || !cwd} title="Subir archivos a esta carpeta">
        <Upload size={14} />
        <span className="fx-btn-label">Subir</span>
      </button>
      <button className="btn btn-sm" onClick={() => onUpload(true)} disabled={offline || !cwd} title="Subir carpetas a esta carpeta">
        <FolderUp size={14} />
        <span className="fx-btn-label">Subir carpeta</span>
      </button>
      <button className="btn btn-sm" onClick={onDownload} disabled={offline || !hasSelection} title="Descargar los elementos seleccionados">
        <Download size={14} />
        <span className="fx-btn-label">Descargar</span>
      </button>
      <span className="fx-actions-sep" />
      <button className="btn btn-sm" onClick={() => onCreate("dir")} disabled={offline || !cwd} title="Nueva carpeta">
        <FolderPlus size={14} />
        <span className="fx-btn-label">Nueva carpeta</span>
      </button>
      <button className="btn btn-sm" onClick={() => onCreate("file")} disabled={offline || !cwd} title="Nuevo archivo">
        <FilePlus size={14} />
        <span className="fx-btn-label">Nuevo archivo</span>
      </button>
      <span className="fx-actions-fill" />
      <button
        className={showHidden ? "icon-btn fx-toggle on" : "icon-btn fx-toggle"}
        onClick={onToggleHidden}
        title={showHidden ? "Ocultar archivos ocultos" : "Mostrar archivos ocultos"}
        aria-label="Mostrar archivos ocultos"
        aria-pressed={showHidden}
      >
        {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
    </div>
  );
}
