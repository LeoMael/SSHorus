// Lectura de una sub-pestaña de Administración guardada por sesión (Servicios, Paquetes, Tareas): se lee
// al abrirla si no hay nada guardado, otra vez si ahora hay sudo y lo guardado se leyó sin él, y al
// terminar bien un cambio suyo (su tarea en segundo plano).
import { useEffect, useRef } from "react";
import type { Elevation } from "../../features/privileges";
import { useJobFinished } from "../Jobs/useJobFinished";

export function useTabRead(o: {
  sessionId: string;
  /** Tipo de tarea de sus cambios. */
  jobKind: string;
  hasData: boolean;
  /** Lo guardado se leyó con sudo. */
  elevatedData: boolean;
  disabled: boolean;
  elevation: Elevation | null;
  load: () => void;
}): void {
  const { sessionId, jobKind, hasData, elevatedData, disabled, elevation, load } = o;
  const tried = useRef<Elevation | null | undefined>(undefined);
  useEffect(() => {
    if (disabled || tried.current === elevation) return;
    tried.current = elevation;
    if (!hasData || (elevation && !elevatedData)) load();
  }, [disabled, elevation, hasData, elevatedData, load]);
  useJobFinished(
    (j) => j.kind === jobKind && j.sessionId === sessionId && j.status === "done",
    () => load(),
  );
}
