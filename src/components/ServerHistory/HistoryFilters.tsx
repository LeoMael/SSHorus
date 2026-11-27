// Barra del historial: buscar, filtrar por origen y por resultado, y exportar lo que se ve.
import { FileDown, RefreshCw, Search, X } from "lucide-react";
import { SOURCES, type TimelineSource } from "../../features/serverHistory";

interface Props {
  text: string;
  onText: (t: string) => void;
  sources: ReadonlySet<TimelineSource>;
  onToggleSource: (s: TimelineSource | null) => void;
  counts: Partial<Record<TimelineSource, number>>;
  onlyErrors: boolean;
  onOnlyErrors: (v: boolean) => void;
  onExport: (format: "txt" | "json") => void;
  canExport: boolean;
  onReload: () => void;
}

export function HistoryFilters(p: Props) {
  return (
    <div className="sh-filters">
      <div className="sh-filter-row">
        <div className="sh-search">
          <Search size={13} aria-hidden />
          <input
            className="input"
            placeholder="Buscar comando, resultado, asistente…"
            value={p.text}
            aria-label="Buscar en el historial"
            spellCheck={false}
            onChange={(e) => p.onText(e.target.value)}
          />
          {p.text && (
            <button className="icon-btn sh-search-clear" onClick={() => p.onText("")} aria-label="Borrar búsqueda">
              <X size={12} />
            </button>
          )}
        </div>
        <label className="sh-check">
          <input type="checkbox" checked={p.onlyErrors} onChange={(e) => p.onOnlyErrors(e.target.checked)} /> Solo lo que falló
        </label>
        <div className="sh-spacer" />
        <button className="icon-btn" onClick={p.onReload} title="Volver a leer" aria-label="Volver a leer">
          <RefreshCw size={14} />
        </button>
        <button className="btn btn-sm" disabled={!p.canExport} onClick={() => p.onExport("txt")} title="Exportar lo que se ve a un archivo de texto">
          <FileDown size={13} /> Texto
        </button>
        <button className="btn btn-sm" disabled={!p.canExport} onClick={() => p.onExport("json")} title="Exportar lo que se ve a JSON">
          <FileDown size={13} /> JSON
        </button>
      </div>
      <div className="sh-chips" role="group" aria-label="Filtrar por origen">
        <button className={`sh-chip${p.sources.size === 0 ? " on" : ""}`} aria-pressed={p.sources.size === 0} onClick={() => p.onToggleSource(null)}>
          Todo
        </button>
        {SOURCES.map((s) => {
          const n = p.counts[s.id] ?? 0;
          const on = p.sources.has(s.id);
          return (
            <button key={s.id} className={`sh-chip${on ? " on" : ""}`} aria-pressed={on} disabled={!n && !on} onClick={() => p.onToggleSource(s.id)}>
              {s.label} <span className="faint">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
