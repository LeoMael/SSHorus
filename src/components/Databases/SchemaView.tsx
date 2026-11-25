// Esquema de una base: búsqueda, lista de tablas y vistas (o el diagrama) y el detalle de la elegida.
import { useMemo, useState } from "react";
import { Eye, Search, Table2 } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { Segmented } from "../ui/Segmented";
import { tableId } from "../../features/databases/diagram";
import { filterTables, rowsText, withNeighbors } from "../../features/databases/view";
import type { DbSchema, DbTable } from "../../features/databases/types";
import { SchemaDiagram } from "./SchemaDiagram";
import { TableDetail } from "./TableDetail";

type Mode = "tables" | "diagram";

interface Props {
  schema: DbSchema;
  onCopyDdl: (t: DbTable) => Promise<void>;
}

export function SchemaView({ schema, onCopyDdl }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("tables");
  const [picked, setPicked] = useState<string | null>(null);
  const shown = useMemo(() => filterTables(schema.tables, query), [schema.tables, query]);
  const forDiagram = useMemo(() => (query.trim() ? withNeighbors(schema.tables, shown) : schema.tables), [schema.tables, shown, query]);
  const current = schema.tables.find((t) => tableId(t) === picked) ?? shown[0] ?? null;
  const manySchemas = new Set(schema.tables.map((t) => t.schema)).size > 1;

  const open = (s: string, name: string) => {
    setPicked(`${s}.${name}`);
    setQuery("");
  };

  return (
    <div className="db-schema">
      <div className="db-schema-bar">
        <label className="db-search">
          <Search size={13} className="faint" />
          <input className="input" value={query} placeholder="Buscar tabla o columna…" onChange={(e) => setQuery(e.target.value)} aria-label="Buscar tabla o columna" />
        </label>
        <Segmented<Mode>
          label="Vista"
          value={mode}
          onChange={setMode}
          options={[
            { value: "tables", label: "Tablas" },
            { value: "diagram", label: "Diagrama", title: "Cajas y flechas de las claves foráneas" },
          ]}
        />
        <span className="faint db-count">
          {shown.length === schema.tables.length ? `${schema.tables.length} tablas y vistas` : `${shown.length} de ${schema.tables.length}`}
          {schema.version && ` · ${schema.version}`}
        </span>
      </div>
      {schema.truncated && <div className="db-banner">El esquema es muy grande y la lectura se cortó: falta una parte.</div>}

      {schema.tables.length === 0 ? (
        <div className="empty-state">Esta base no tiene tablas (o tu usuario no puede verlas).</div>
      ) : (
        <div className={mode === "diagram" ? "db-split db-split-diagram" : "db-split"}>
          {mode === "diagram" ? (
            <SchemaDiagram tables={forDiagram} selected={current ? tableId(current) : null} onPick={(t) => setPicked(tableId(t))} />
          ) : (
            <ul className="db-tables" role="listbox" aria-label="Tablas">
              {shown.map((t) => {
                const id = tableId(t);
                const on = !!current && tableId(current) === id;
                return (
                  <li key={id} role="option" aria-selected={on} className={on ? "db-table on" : "db-table"} onClick={() => setPicked(id)}>
                    {t.kind === "table" || t.kind === "partitioned" ? <Table2 size={13} className="faint" /> : <Eye size={13} className="faint" />}
                    <span className="mono db-table-name">
                      {manySchemas && <span className="faint">{t.schema}.</span>}
                      {t.name}
                    </span>
                    <span className="faint db-table-meta">{[rowsText(t.rows), t.bytes ? formatBytes(t.bytes) : null].filter(Boolean).join(" · ")}</span>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="faint db-none">Nada coincide con «{query}».</li>}
            </ul>
          )}
          {current && <TableDetail key={tableId(current)} table={current} onOpen={open} onCopyDdl={() => onCopyDdl(current)} />}
        </div>
      )}
    </div>
  );
}
