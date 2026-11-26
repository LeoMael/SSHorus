// Piezas comunes de los diálogos de arreglo de la auditoría: aviso de sudo, resultado de un arreglo y
// pie con Cerrar.
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { outcomeText, type FixResult, type RecheckOutcome } from "../../../features/audit";
import { useAdmin } from "../context";
import type { FixPhase } from "./useAuditFix";

/** Sin sudo no se puede arreglar: ofrece escribir la contraseña (si se guarda, se usa sola la próxima vez). */
export function NeedSudo() {
  const { elevation, elev, askSudo } = useAdmin();
  if (elevation) return null;
  return (
    <div className="adm-banner adm-banner-warn">
      <AlertTriangle size={14} />
      <span className="adm-banner-text">Hace falta root o sudo para arreglarlo.</span>
      {elev.canAskSudo && (
        <button className="btn btn-sm" onClick={askSudo}>
          <KeyRound size={13} /> Contraseña de sudo…
        </button>
      )}
    </div>
  );
}

/** Cómo quedó tras volver a comprobar (o el fallo del comando). */
export function OutcomeLine({ result, outcome }: { result?: FixResult; outcome?: RecheckOutcome }) {
  if (outcome?.state === "fixed")
    return (
      <span className="au-fx-line au-fx-ok">
        <CheckCircle2 size={13} /> Arreglado
      </span>
    );
  if (outcome)
    return (
      <span className="au-fx-line au-fx-warn">
        <AlertTriangle size={13} /> {outcomeText(outcome)}
      </span>
    );
  if (result && !result.ok)
    return (
      <span className="au-fx-line au-fx-bad">
        <XCircle size={13} /> {result.canceled ? "Cancelado" : "El comando falló"}
      </span>
    );
  return null;
}

/** Pie: mientras corre, cerrar deja la tarea en segundo plano (su «Cancelar» está en la tarea). */
export function FixFooter({ phase, onClose, children }: { phase: FixPhase; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>
        {phase === "running" ? "Cerrar (sigue en segundo plano)" : phase === "done" ? "Cerrar" : "Cancelar"}
      </button>
      {children}
    </div>
  );
}
