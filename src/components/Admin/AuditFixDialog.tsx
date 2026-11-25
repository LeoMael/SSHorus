// «Arreglar» un problema de la auditoría: enseña el comando exacto, comprueba antes lo que podría dejarte
// fuera (llave instalada, no entrar como root, puerto de SSH), pide confirmación, lo ejecuta con sudo
// como tarea en segundo plano (salida en vivo, cancelable) y vuelve a comprobar para decir si quedó
// arreglado o por qué no.
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from "lucide-react";
import { errorMessage } from "../../api/core";
import type { AuditReport, Check } from "../../api/audit";
import { guardOkText, guardProblem, needsGuard, readGuard } from "../../features/audit";
import { AdmModal } from "../ui/AdmModal";
import { FixFooter, NeedSudo, OutcomeLine } from "./AuditFixParts";
import { useAdmin } from "./context";
import { elevationText } from "./PlanReview";
import { useAuditFix } from "./useAuditFix";
import { JobPanel } from "../Jobs/JobPanel";

const CONFIRM_WORD = "ARREGLAR";

type Guard = { state: "checking" } | { state: "ok"; text: string | null } | { state: "blocked"; text: string };

function useGuard(check: Check): Guard | null {
  const { sessionId, profileId } = useAdmin();
  const [guard, setGuard] = useState<Guard | null>(needsGuard(check) ? { state: "checking" } : null);
  useEffect(() => {
    if (!needsGuard(check)) return;
    let alive = true;
    readGuard(sessionId, profileId)
      .then((g) => {
        if (!alive) return;
        const problem = guardProblem(check, g);
        setGuard(problem ? { state: "blocked", text: problem } : { state: "ok", text: guardOkText(check, g) });
      })
      .catch((e) => alive && setGuard({ state: "blocked", text: `No se pudo comprobar antes: ${errorMessage(e)}` }));
    return () => {
      alive = false;
    };
  }, [check, sessionId, profileId]);
  return guard;
}

export function AuditFixDialog({
  check,
  report,
  onClose,
}: {
  check: Check;
  report: AuditReport;
  onClose: () => void;
}) {
  const { elevation, disabled } = useAdmin();
  const guard = useGuard(check);
  const fx = useAuditFix();
  const [typed, setTyped] = useState("");
  const fix = check.fix;
  if (!fix) return null;
  const result = fx.results[check.id];
  const outcome = fx.outcomes[check.id];
  const blocked =
    !elevation || disabled || fx.phase !== "idle" || guard?.state === "checking" || guard?.state === "blocked" || (fix.danger && typed !== CONFIRM_WORD);

  return (
    <AdmModal title={`Arreglar: ${check.title}`} onClose={onClose} width={620}>
      <div className="modal-body adm-review">
        {fix.note && (
          <div className={fix.danger ? "adm-banner adm-banner-warn" : "faint"}>
            {fix.danger && <ShieldAlert size={14} />} {fix.note}
          </div>
        )}
        {guard?.state === "checking" && (
          <div className="faint">
            <span className="spinner adm-spinner-btn" /> Comprobando que no te quedas fuera…
          </div>
        )}
        {guard?.state === "blocked" && (
          <div className="adm-error" role="alert">
            <AlertTriangle size={14} />
            <pre>{guard.text}</pre>
          </div>
        )}
        {guard?.state === "ok" && guard.text && (
          <div className="au-fx-line au-fx-ok">
            <CheckCircle2 size={13} /> {guard.text}
          </div>
        )}
        <NeedSudo />
        <div className="adm-review-label">{elevationText(elevation)}</div>
        <pre className="adm-cmd" aria-label="Comandos que se ejecutarán">
          {fix.command}
        </pre>
        {fix.danger && fx.phase === "idle" && guard?.state !== "blocked" && (
          <label className="field adm-confirm-word">
            <span>
              Puede cortar el acceso o un servicio. Para confirmar, escribe <strong className="mono">{CONFIRM_WORD}</strong>
            </span>
            <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        {fx.phase === "done" && <OutcomeLine result={result} outcome={outcome} />}
        {fx.job && <JobPanel job={fx.job} compact />}
      </div>
      <FixFooter phase={fx.phase} onClose={onClose}>
        {fx.phase === "idle" && (
          <button className={fix.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => void fx.start(report, [check])} disabled={blocked} autoFocus={!fix.danger}>
            <Play size={13} /> Arreglar
          </button>
        )}
        {fx.phase === "done" && result && !result.ok && (
          <button className="btn btn-primary" onClick={() => void fx.start(report, [check])} disabled={!elevation || disabled}>
            <Play size={13} /> Reintentar
          </button>
        )}
      </FixFooter>
    </AdmModal>
  );
}
