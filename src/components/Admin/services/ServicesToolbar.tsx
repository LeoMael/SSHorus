// Barra de «Servicios»: de quién (el sistema o un usuario), búsqueda, filtro por estado y recargar.
import { RefreshCw, Search, X } from "lucide-react";
import type { HumanUser, RunState } from "../../../features/services";
import { Segmented } from "../../ui/Segmented";

export type StateFilter = "all" | "failed" | "running" | "stopped";

const FILTERS: { value: StateFilter; label: string; title?: string }[] = [
  { value: "all", label: "Todos" },
  { value: "failed", label: "Caídos", title: "Fallaron al arrancar o se cayeron" },
  { value: "running", label: "Activos" },
  { value: "stopped", label: "Parados" },
];

export function ServicesToolbar(p: {
  humans: HumanUser[];
  me: string | null;
  /** "" = del sistema; si no, el usuario. */
  scope: string;
  onScope: (s: string) => void;
  query: string;
  onQuery: (q: string) => void;
  filter: StateFilter;
  onFilter: (f: StateFilter) => void;
  counts: Record<RunState | "all", number>;
  loading: boolean;
  disabled: boolean;
  onReload: () => void;
}) {
  return (
    <div className="adm-toolbar">
      <select className="input svc-scope" value={p.scope} onChange={(e) => p.onScope(e.target.value)} aria-label="De quién son los servicios">
        <option value="">Del sistema</option>
        {p.humans.map((h) => (
          <option key={h.name} value={h.name}>
            De {h.name}
            {h.name === p.me ? " (tú)" : ""}
            {h.runtimeDir ? "" : " · sin sesión"}
          </option>
        ))}
      </select>
      <div className="adm-search adm-search-wide">
        <Search size={13} />
        <input
          className="input"
          placeholder="Nombre o descripción (caddy, podman…)"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && p.query) {
              e.stopPropagation();
              p.onQuery("");
            }
          }}
          aria-label="Buscar servicios"
        />
        {p.query && (
          <button className="icon-btn adm-search-clear" onClick={() => p.onQuery("")} aria-label="Limpiar búsqueda">
            <X size={12} />
          </button>
        )}
      </div>
      <Segmented<StateFilter>
        label="Estado"
        value={p.filter}
        onChange={p.onFilter}
        options={FILTERS.map((f) => ({
          value: f.value,
          title: f.title,
          label: (
            <>
              {f.label} <span className="adm-seg-n">{p.counts[f.value]}</span>
            </>
          ),
        }))}
      />
      <span className="adm-spacer" />
      <button className="btn btn-sm" onClick={p.onReload} disabled={p.disabled || p.loading} title="Vuelve a leer los servicios (solo lee)">
        {p.loading ? <span className="spinner adm-spinner-btn" /> : <RefreshCw size={13} />} Volver a leer
      </button>
    </div>
  );
}
