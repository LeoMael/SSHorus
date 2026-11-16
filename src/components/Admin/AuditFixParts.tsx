// Piezas comunes de los diálogos de arreglo de la auditoría: aviso de sudo, resultado de un arreglo y
// pie con Cancelar / Cerrar.
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Square, XCircle } from "lucide-react";
import { outcomeText, useAuditRun, type FixResult, type RecheckOutcome } from "../../features/audit";
import { useAdmin } from "./context";
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

/** Pie: mientras corre, «Cancelar» (para el comando); después, «Cerrar». */
export function FixFooter({
  phase,
  executing,
  onCancel,
  onClose,
  children,
}: {
  phase: FixPhase;
  executing: boolean;
  onCancel: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { sessionId } = useAdmin();
  const step = useAuditRun((s) => s.running[sessionId]);
  return (
    <div className="modal-footer">
      {phase === "running" && (
        <span className="au-fx-step faint">
          <span className="spinner adm-spinner-btn" /> {step ?? "Aplicando…"}
        </span>
      )}
      {phase === "running" ? (
        <button className="btn" onClick={onCancel} disabled={!executing} title="Para el comando en el servidor">
          <Square size={13} /> Cancelar
        </button>
      ) : (
        <button className="btn" onClick={onClose}>
          {phase === "done" ? "Cerrar" : "Cancelar"}
        </button>
      )}
      {children}
    </div>
  );
}
