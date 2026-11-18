// Lo que el explorador muestra sobre su estado: barra inferior, «Reconectando…» y el aviso de la lista.
import type { ReactNode } from "react";
import { ArrowUp, House, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { errorMessage } from "../../api/core";
import type { FileEntry } from "../../api/types";
import { formatBytes } from "../../lib/format";
import { useTransfers } from "../../stores/transfers";
import { filesBytes, plural } from "./explorerLogic";
import { isDirLike } from "./icons";

/** Progreso de "preparando para arrastrar" (lee el lote del panel de transferencias). */
function DragPrepStatus({ batchId, label, onCancel }: { batchId: string | null; label: string; onCancel: () => void }) {
  const b = useTransfers((s) => (batchId ? s.batches[batchId] : undefined));
  const pct = b && b.bytesTotal > 0 ? Math.floor((b.bytesDone / b.bytesTotal) * 100) : null;
  return (
    <span className="fx-dragprep" role="status" aria-live="polite">
      · <RefreshCw size={12} className="fx-spin" /> Preparando para arrastrar {label}
      {pct !== null && ` ${pct}%`}…
      <button className="fx-dragprep-cancel" onClick={onCancel} disabled={!batchId}>
        Cancelar
      </button>
    </span>
  );
}

interface StatusProps {
  shown: number;
  total: number;
  selectedEntries: FileEntry[];
  dragPrep: { batchId: string | null; label: string } | null;
  onCancelDragPrep: () => void;
}

export function ExplorerStatus({ shown, total, selectedEntries, dragPrep, onCancelDragPrep }: StatusProps) {
  const selSize = filesBytes(selectedEntries);
  const hasSelDirs = selectedEntries.some(isDirLike);
  return (
    <div className="fx-status">
      <span>
        {plural(shown, "elemento", "elementos")}
        {shown !== total && <span className="faint"> (de {total})</span>}
      </span>
      {selectedEntries.length > 0 && (
        <span>
          · {plural(selectedEntries.length, "seleccionado", "seleccionados")}
          {selSize > 0 || !hasSelDirs ? ` (${formatBytes(selSize)}${hasSelDirs ? " + carpetas" : ""})` : ""}
        </span>
      )}
      {dragPrep && <DragPrepStatus batchId={dragPrep.batchId} label={dragPrep.label} onCancel={onCancelDragPrep} />}
    </div>
  );
}

export function ReconnectingPill() {
  return (
    <div className="fx-reconnecting" role="status" aria-live="polite">
      <span className="fx-reconnecting-pill">
        <RefreshCw size={13} className="fx-spin" />
        Reconectando…
      </span>
    </div>
  );
}

interface PlaceholderState {
  closed: boolean;
  closedReason: string | null;
  error: { path: string; err: unknown } | null;
  cwd: string | null;
  rowCount: number;
  entryCount: number;
  filter: string;
  refresh: () => void;
  openParent: (path: string) => void;
  goHome: () => void;
}

/** Lo que se ve en lugar de las filas (conexión cerrada, error, cargando o vacío); undefined si hay filas. */
export function explorerPlaceholder(s: PlaceholderState): ReactNode {
  const { error } = s;
  if (s.closed) {
    return (
      <div className="empty-state fx-error">
        <Unplug size={28} />
        <strong>Conexión cerrada</strong>
        <span className="fx-error-msg">{s.closedReason ?? "Se perdió la conexión con el servidor"}</span>
      </div>
    );
  }
  if (error && (!s.cwd || error.path === s.cwd)) {
    const atRoot = error.path === "/" || error.path === "~";
    return (
      <div className="empty-state fx-error">
        <TriangleAlert size={28} />
        <strong>No se pudo abrir la carpeta</strong>
        <span className="fx-error-msg">{errorMessage(error.err)}</span>
        <div className="fx-error-actions">
          <button className="btn btn-sm btn-primary" onClick={s.refresh}>
            <RefreshCw size={14} /> Reintentar
          </button>
          {!atRoot && (
            <button className="btn btn-sm" onClick={() => s.openParent(error.path)}>
              <ArrowUp size={14} /> Subir un nivel
            </button>
          )}
          <button className="btn btn-sm" onClick={s.goHome}>
            <House size={14} /> Ir al inicio
          </button>
        </div>
      </div>
    );
  }
  if (s.cwd === null) {
    return (
      <div className="empty-state">
        <div className="spinner" />
        <span>Cargando…</span>
      </div>
    );
  }
  if (!s.rowCount) {
    return (
      <div className="empty-state fx-empty">
        {s.filter.trim() ? (
          <span>Nada coincide con «{s.filter.trim()}»</span>
        ) : s.entryCount ? (
          <span>Solo hay archivos ocultos</span>
        ) : (
          <span>Carpeta vacía</span>
        )}
        <span className="faint">Arrastra archivos aquí para subirlos</span>
      </div>
    );
  }
  return undefined;
}
