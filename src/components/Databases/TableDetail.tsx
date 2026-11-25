// Detalle de una tabla: columnas (tipo, nulo, por defecto, clave primaria), índices, claves foráneas y
// «Copiar DDL».
import { useState } from "react";
import { Copy, KeyRound, Link2 } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { KIND_LABEL, rowsText } from "../../features/databases/view";
import type { DbTable } from "../../features/databases/types";

interface Props {
  table: DbTable;
  /** Ir a otra tabla (al pulsar una clave foránea). */
  onOpen: (schema: string, name: string) => void;
  onCopyDdl: () => Promise<void>;
}

export function TableDetail({ table: t, onOpen, onCopyDdl }: Props) {
  const [copying, setCopying] = useState(false);
  const copy = async () => {
    setCopying(true);
    await onCopyDdl();
    setCopying(false);
  };
  const facts = [KIND_LABEL[t.kind], rowsText(t.rows), t.bytes ? formatBytes(t.bytes) : null].filter(Boolean).join(" · ");

  return (
    <div className="db-detail">
      <div className="db-detail-head">
        <div className="db-detail-title">
          <span className="mono">
            {t.schema && <span className="faint">{t.schema}.</span>}
            {t.name}
          </span>
          <span className="faint db-detail-facts">{facts}</span>
        </div>
        <button className="btn btn-sm" onClick={() => void copy()} disabled={copying} title="Copia la definición (CREATE TABLE …) al portapapeles">
          {copying ? <span className="spinner db-spinner-btn" /> : <Copy size={13} />} Copiar DDL
        </button>
      </div>
      {t.comment && <p className="db-comment">{t.comment}</p>}

      <div className="section-label db-sub">Columnas ({t.columns.length})</div>
      <table className="db-grid">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Nulo</th>
            <th>Por defecto</th>
          </tr>
        </thead>
        <tbody>
          {t.columns.map((c) => (
            <tr key={c.name}>
              <td className="mono">
                {c.pk && <KeyRound size={11} className="db-pk" aria-label="Clave primaria" />}
                {c.name}
              </td>
              <td className="mono faint">{c.type}</td>
              <td>{c.nullable ? "sí" : "no"}</td>
              <td className="mono faint db-default" title={c.default ?? undefined}>
                {c.default ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {t.indexes.length > 0 && (
        <>
          <div className="section-label db-sub">Índices ({t.indexes.length})</div>
          <ul className="db-list">
            {t.indexes.map((i) => (
              <li key={i.name}>
                <span className="mono">{i.name}</span>
                {i.primary ? <span className="db-tag">clave primaria</span> : i.unique && <span className="db-tag">único</span>}
                <span className="mono faint">{i.columns}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {t.foreignKeys.length > 0 && (
        <>
          <div className="section-label db-sub">Claves foráneas ({t.foreignKeys.length})</div>
          <ul className="db-list">
            {t.foreignKeys.map((f) => (
              <li key={f.name}>
                <Link2 size={12} className="faint" />
                <span className="mono">{f.columns.join(", ")}</span>
                <span className="faint">→</span>
                <button className="db-link mono" onClick={() => onOpen(f.refSchema, f.refTable)} title="Ver esa tabla">
                  {f.refTable}({f.refColumns.join(", ")})
                </button>
                <span className="faint mono db-fk-name">{f.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
