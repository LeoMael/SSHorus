// Botones de abajo de «Actualizar imagen»: cambian según la etapa (leyendo, revisión, reemplazo, final).
import { Play, RefreshCw, SkipForward, Square } from "lucide-react";

export function ImageUpdateFooter({
  running,
  stage,
  replacing,
  canRun,
  hasError,
  submitBlocked,
  jobRunning,
  onCancelRun,
  onSkip,
  onReplace,
  onStart,
  onRescan,
  onClose,
}: {
  /** Hay algo en marcha en el diálogo (no la tarea en segundo plano): solo se puede cancelar. */
  running: boolean;
  stage: string;
  /** Hay un contenedor `run` en pantalla para reemplazar. */
  replacing: boolean;
  /** Hay elevación y conexión. */
  canRun: boolean;
  hasError: boolean;
  submitBlocked: boolean;
  jobRunning: boolean;
  onCancelRun: () => void;
  onSkip: () => void;
  onReplace: () => void;
  onStart: () => void;
  onRescan: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-footer">
      {running ? (
        <button className="btn" onClick={onCancelRun}>
          <Square size={13} /> Cancelar
        </button>
      ) : stage === "replace" && replacing ? (
        <>
          <button className="btn" onClick={onSkip} title="No se toca este contenedor (seguirá con la imagen vieja)">
            <SkipForward size={13} /> Saltar este
          </button>
          <button className="btn btn-primary" onClick={onReplace} disabled={submitBlocked}>
            <Play size={13} /> {hasError ? "Reintentar" : "Reemplazar"}
          </button>
        </>
      ) : stage === "review" ? (
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={onStart} disabled={!canRun} autoFocus>
            <Play size={13} /> Actualizar imagen
          </button>
        </>
      ) : (
        <>
          {stage === "done" && (
            <button className="btn" onClick={onRescan} disabled={!canRun} title="Vuelve a analizar solo esta imagen">
              <RefreshCw size={13} /> Volver a escanear
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            {jobRunning ? "Cerrar (sigue en segundo plano)" : "Cerrar"}
          </button>
        </>
      )}
    </div>
  );
}
