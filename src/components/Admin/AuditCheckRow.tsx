// Una comprobación de la auditoría: estado, detalle, botón «Arreglar» (si tiene arreglo), qué hacer si no
// lo tiene y, tras arreglarla, cómo quedó.
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Info, Wrench, XCircle } from "lucide-react";
import type { Check, CheckStatus } from "../../api/audit";
import { STATUS_TEXT, adviceFor, fixLevel, outcomeText, type Change, type RecheckOutcome } from "../../features/audit";
import { RebootButton } from "../../features/reboot";
import { useAdmin } from "./context";
import { CommandActions } from "./vulnUi";

const ICON: Record<CheckStatus, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Info, skip: CircleDashed };
const CHANGE_TEXT: Record<Change, string> = { better: "mejoró", worse: "empeoró", new: "nuevo" };

export interface FixAvailability {
  /** Se puede pulsar «Arreglar». */
  ok: boolean;
  /** Por qué no (título del botón). */
  why: string | null;
}

export function AuditCheckRow({
  check,
  change,
  outcome,
  fixable,
  onFix,
  onOpenVulns,
  onRebooted,
}: {
  check: Check;
  change: Change | null;
  outcome: RecheckOutcome | null;
  fixable: FixAvailability;
  onFix: () => void;
  onOpenVulns?: () => void;
  /** «Reinicio pendiente»: «Reiniciar ahora» en vez de «Arreglar»; se llama al terminar el reinicio. */
  onRebooted?: () => void;
}) {
  const { sessionId } = useAdmin();
  const level = fixLevel(check);
  const problem = level !== null;
  const [open, setOpen] = useState(check.status === "bad");
  const Icon = ICON[check.status];
  const advice = level === "manual" ? adviceFor(check) : null;
  const expandable = check.items.length > 0 || (problem && (!!check.fix || !!advice));
  return (
    <div className={`au-check au-${check.status}`}>
      <div className="au-check-head">
        <button className="au-toggle" onClick={() => setOpen(!open)} disabled={!expandable} aria-expanded={open} aria-label={open ? "Ocultar detalle" : "Ver detalle"}>
          {expandable ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="au-toggle-sp" />}
        </button>
        <Icon size={14} className="au-icon" aria-label={STATUS_TEXT[check.status]} />
        <span className="au-title">{check.title}</span>
        <span className="au-detail">{check.detail}</span>
        {outcome?.state === "fixed" && <span className="au-chip au-chip-better">arreglado</span>}
        {!outcome && change && <span className={`au-chip au-chip-${change}`}>{CHANGE_TEXT[change]}</span>}
        {onOpenVulns && check.status === "skip" && (
          <button className="btn btn-sm" onClick={onOpenVulns}>
            Analizar
          </button>
        )}
        {onRebooted && problem ? (
          <RebootButton sessionId={sessionId} onRebooted={onRebooted} />
        ) : (level === "auto" || level === "confirm") && (
          <button
            className={level === "confirm" ? "btn btn-sm btn-danger" : "btn btn-sm"}
            onClick={onFix}
            disabled={!fixable.ok}
            title={fixable.why ?? (level === "confirm" ? "Puede cortar el acceso: se comprueba antes y pide confirmación" : "Muestra el comando antes de ejecutarlo")}
          >
            <Wrench size={12} /> Arreglar
          </button>
        )}
      </div>
      {outcome && outcome.state !== "fixed" && <div className="au-fx-reason">{outcomeText(outcome)}</div>}
      {open && expandable && (
        <div className="au-body">
          {advice && <div className="au-advice">Qué hacer: {advice}</div>}
          {check.items.length > 0 && (
            <ul className="au-items">
              {check.items.slice(0, 100).map((i) => (
                <li key={i} className="mono">
                  {i}
                </li>
              ))}
              {check.items.length > 100 && <li className="faint">… y {check.items.length - 100} más</li>}
            </ul>
          )}
          {problem && check.fix && (
            <div className="au-fix">
              <div className="faint">
                {check.fix.manual ? "Para revisar a mano" : "Arreglo"}
                {check.fix.note && !advice ? ` · ${check.fix.note}` : ""}
              </div>
              <pre className="adm-cmd adm-cmd-sm">{check.fix.command}</pre>
              {check.fix.manual && (
                <div className="au-fix-actions">
                  <CommandActions sessionId={sessionId} text={check.fix.command} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
