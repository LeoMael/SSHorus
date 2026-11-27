// Barra de arriba del mapa: alcance, filtros, usuarios, listas plegadas, minimapa, exportar y actualizar.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, Map as MapIcon, RefreshCw } from "lucide-react";
import { ownerLabel, type MapScope } from "../../features/infra";
import type { ExportFormat } from "./exportMap";
import { UpdatedAgo } from "./MapOverlays";
import { ScopeSwitch } from "./MapScope";

export interface ToolbarProps {
  scope: { available: boolean; current: MapScope | null; setAll: (v: MapScope) => void };
  hideLocal: boolean;
  setHideLocal: (v: boolean) => void;
  hideSystem: boolean;
  setHideSystem: (v: boolean) => void;
  allOwners: string[];
  owners: Set<string> | null;
  onAllOwners: () => void;
  onToggleOwner: (o: string) => void;
  /** Nodos escondidos en tarjetas «+N» y columnas desplegadas a mano. */
  folded: { hidden: number; expanded: number; onExpandAll: () => void; onCollapse: () => void };
  miniOn: boolean;
  onToggleMini: () => void;
  canExport: boolean;
  onExport: (f: ExportFormat) => void;
  updatedAt: number | null;
  loading: boolean;
  onRefresh: () => void;
  extraTools?: ReactNode;
}

export function MapToolbar(p: ToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const doExport = (f: ExportFormat) => {
    setExportOpen(false);
    p.onExport(f);
  };
  const { folded } = p;
  return (
    <div className="im-toolbar">
      <div className="im-filters" role="group" aria-label="Filtros">
        {p.scope.available && <ScopeSwitch value={p.scope.current} onChange={p.scope.setAll} />}
        <label className="im-check">
          <input type="checkbox" checked={p.hideLocal} onChange={(e) => p.setHideLocal(e.target.checked)} /> Ocultar locales
        </label>
        <label className="im-check">
          <input type="checkbox" checked={p.hideSystem} onChange={(e) => p.setHideSystem(e.target.checked)} /> Ocultar sistema
        </label>
        {p.allOwners.length > 1 && (
          <div className="im-owners" role="group" aria-label="Usuarios">
            <button className={`im-chip${p.owners === null ? " on" : ""}`} onClick={p.onAllOwners}>
              Todos
            </button>
            {p.allOwners.map((o) => (
              <button key={o} className={`im-chip${!p.owners || p.owners.has(o) ? " on" : ""}`} onClick={() => p.onToggleOwner(o)} aria-pressed={!p.owners || p.owners.has(o)}>
                {ownerLabel(o, true)}
              </button>
            ))}
          </div>
        )}
        {folded.hidden > 0 ? (
          <button className="btn btn-sm" onClick={folded.onExpandAll} title="Las listas largas se agrupan en tarjetas «+N». Mostrar todos sus elementos">
            <ChevronsUpDown size={13} /> Mostrar todo ({folded.hidden} agrupados)
          </button>
        ) : (
          folded.expanded > 0 && (
            <button className="btn btn-sm" onClick={folded.onCollapse} title="Volver a agrupar las listas largas en tarjetas «+N»">
              <ChevronsDownUp size={13} /> Agrupar listas largas
            </button>
          )
        )}
      </div>
      <div className="im-tools">
        {p.extraTools}
        <button className={`icon-btn${p.miniOn ? " active" : ""}`} onClick={p.onToggleMini} title="Minimapa" aria-label="Minimapa" aria-pressed={p.miniOn}>
          <MapIcon size={14} />
        </button>
        <div className="im-export">
          <button className="btn btn-sm" onClick={() => setExportOpen((o) => !o)} disabled={!p.canExport} aria-haspopup="menu" aria-expanded={exportOpen}>
            <Download size={13} /> Exportar <ChevronDown size={12} />
          </button>
          {exportOpen && (
            <div className="im-menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
              <button role="menuitem" onClick={() => doExport("png")}>Imagen PNG…</button>
              <button role="menuitem" onClick={() => doExport("svg")}>SVG…</button>
              <button role="menuitem" onClick={() => doExport("mermaid")}>Mermaid…</button>
              <button role="menuitem" onClick={() => doExport("mermaid-copy")}>Copiar Mermaid</button>
            </div>
          )}
        </div>
        <UpdatedAgo at={p.updatedAt} loading={p.loading} />
        <button className="btn btn-sm" onClick={p.onRefresh} disabled={p.loading}>
          <RefreshCw size={13} className={p.loading ? "adm-spin" : undefined} /> Actualizar
        </button>
      </div>
    </div>
  );
}
