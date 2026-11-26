// Barra de la lista de contenedores: filtro (todos, en marcha, parados), búsqueda, actualizar y «Nuevo contenedor».
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { PICK_OWNER_HINT, type CtContextValue } from "./context";
import type { ContainerFilter } from "./ContainersTable";

const FILTERS: [ContainerFilter, string][] = [
  ["all", "Todos"],
  ["running", "En marcha"],
  ["stopped", "Parados"],
];

export function ContainersToolbar(p: {
  ct: CtContextValue;
  filter: ContainerFilter;
  onFilter: (f: ContainerFilter) => void;
  counts: Record<ContainerFilter, number>;
  search: string;
  onSearch: (s: string) => void;
}) {
  const { ct } = p;
  const loading = ct.res.containers.loading;
  return (
    <div className="ct-toolbar">
      <div className="ct-seg ct-seg-sm" role="radiogroup" aria-label="Filtro">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="radio" aria-checked={p.filter === f} className={p.filter === f ? "on" : ""} onClick={() => p.onFilter(f)}>
            {label} <span className="ct-count">{p.counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="ct-search">
        <Search size={13} />
        <input
          className="input"
          placeholder="Buscar nombre, imagen, puerto…"
          value={p.search}
          onChange={(e) => p.onSearch(e.target.value)}
          aria-label="Buscar contenedores"
        />
        {p.search && (
          <button className="icon-btn" onClick={() => p.onSearch("")} aria-label="Limpiar búsqueda">
            <X size={12} />
          </button>
        )}
      </div>
      <span className="ct-grow" />
      <button
        className="icon-btn"
        onClick={() => {
          void ct.reload("containers");
          void ct.autostart.reload();
        }}
        title="Actualizar"
        aria-label="Actualizar"
        disabled={loading}
      >
        <RefreshCw size={14} className={loading ? "ct-spin" : undefined} />
      </button>
      <NewContainerButton ct={ct} label="Nuevo contenedor" />
    </div>
  );
}

/** «Nuevo contenedor» (también «Crear el primero» con la lista vacía). Con «Todos», hay que elegir usuario. */
export function NewContainerButton({ ct, label }: { ct: CtContextValue; label: string }) {
  return (
    <button className="btn btn-sm btn-primary" onClick={() => ct.openRunForm()} disabled={!ct.newOwner} title={ct.newOwner ? undefined : PICK_OWNER_HINT}>
      <Plus size={13} /> {label}
    </button>
  );
}
