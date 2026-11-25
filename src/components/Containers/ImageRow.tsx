// Una fila de la tabla de Imágenes: casilla, nombre, dueño, tamaño, uso y acciones de la imagen.
import type { KeyboardEvent } from "react";
import { Bug, Download, Info, Rocket, Trash2 } from "lucide-react";
import { ago, type ImageInfo } from "../../features/containers";
import { formatBytes } from "../../lib/format";
import { useVulnNav } from "../../features/vulnscan/nav";
import { useCt } from "./context";

interface Props {
  img: ImageInfo;
  inUse: number;
  selected: boolean;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => void;
  onDetails: () => void;
  onPull: () => void;
  onRemove: () => void;
}

export function ImageRow({ img, inUse, selected, onToggle, onKeyDown, onDetails, onPull, onRemove }: Props) {
  const ct = useCt();
  const name = img.tags[0] ?? img.shortId;
  return (
    <tr tabIndex={0} className={selected ? "sel" : undefined} aria-selected={selected} onKeyDown={onKeyDown} onDoubleClick={onDetails}>
      <td className="ct-col-chk">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Elegir ${name}`} tabIndex={-1} />
      </td>
      <td className="ct-col-name mono" title={img.tags.join("\n") || "<sin nombre>"}>
        <span className="ct-cell-flex">
          <span className="ct-ellipsis">{img.tags[0] ?? <span className="faint">&lt;sin nombre&gt;</span>}</span>
          {img.tags.length > 1 && <span className="ct-tag">+{img.tags.length - 1}</span>}
        </span>
      </td>
      {ct.allOwners && <td className="ct-col-owner ct-ellipsis">{ct.ownerLabel(img.owner)}</td>}
      <td className="ct-col-id mono faint">{img.shortId}</td>
      <td className="ct-col-num mono">{img.size !== null ? formatBytes(img.size) : "—"}</td>
      <td className="ct-col-created faint">{ago(img.created)}</td>
      <td className="ct-col-state">
        {inUse > 0 ? (
          <button className="ct-port" onClick={onDetails} title="Ver qué contenedores la usan" tabIndex={-1}>
            <span className="ct-yes">Sí ({inUse})</span>
          </button>
        ) : (
          <span className="faint">No</span>
        )}
      </td>
      <td className="ct-col-actions">
        <span className="ct-actions">
          <button className="icon-btn" title="Detalles y contenedores que la usan (Intro)" aria-label="Detalles de la imagen" onClick={onDetails} tabIndex={-1}>
            <Info size={13} />
          </button>
          <button
            className="icon-btn ct-go"
            title="Crear contenedor con esta imagen"
            aria-label="Crear contenedor"
            onClick={() => ct.openRunForm({ image: img.tags[0] ?? img.id }, img.owner)}
            tabIndex={-1}
          >
            <Rocket size={13} />
          </button>
          <button
            className="icon-btn"
            title="Actualizar (volver a descargar)"
            aria-label="Actualizar imagen"
            disabled={!img.tags[0] || img.tags[0].startsWith("localhost/")}
            onClick={onPull}
            tabIndex={-1}
          >
            <Download size={13} />
          </button>
          <button
            className="icon-btn"
            title="Ver vulnerabilidades (Administración → Vulnerabilidades)"
            aria-label="Ver vulnerabilidades de la imagen"
            onClick={() => useVulnNav.getState().open(ct.sessionId, img.id, name)}
            tabIndex={-1}
          >
            <Bug size={13} />
          </button>
          <button className="icon-btn ct-danger" title="Eliminar (Supr)" aria-label="Eliminar imagen" onClick={onRemove} tabIndex={-1}>
            <Trash2 size={13} />
          </button>
        </span>
      </td>
    </tr>
  );
}
